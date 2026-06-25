const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const vision = require('@google-cloud/vision');

// Lazy-load: không khởi tạo gRPC client khi load module, tránh timeout deploy
let _visionClient = null;
function getVisionClient() {
  if (!_visionClient) _visionClient = new vision.ImageAnnotatorClient();
  return _visionClient;
}
const DAY_MS = 24 * 60 * 60 * 1000;

const VERIFICATION_REVIEWER_ID = "system_auto_vision";
const AUTO_FAIL_THRESHOLD = 3;
const OCR_FAIL_COUNTERS_COLLECTION = "verification_counters";
const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

const CCCD_FRONT_KEYWORDS = [
  "CAN CUOC",
  "CAN CUOC CONG DAN",
  "SOCIALIST REPUBLIC OF VIET NAM",
  "IDENTITY CARD",
  "HO VA TEN",
  "DATE OF BIRTH",
  "GIOI TINH",
  "QUOC TICH",
];

const CCCD_BACK_KEYWORDS = [
  "DAC DIEM NHAN DANG",
  "NGAY CAP",
  "NOI CAP",
  "CO GIA TRI DEN",
];

function normalizeDigits(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function normalizeNoAccentUpper(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Đ/g, "D");
}

function analyzeSideSignals(text) {
  const normalized = normalizeNoAccentUpper(text);
  const frontScore = CCCD_FRONT_KEYWORDS.filter((k) => normalized.includes(k)).length;
  const backScore = CCCD_BACK_KEYWORDS.filter((k) => normalized.includes(k)).length;
  const hasMrz = /[A-Z0-9<]{20,}/.test(normalized) || (normalized.match(/</g) || []).length >= 8;
  return { frontScore, backScore, hasMrz };
}

function isFrontSide(signals) {
  return signals.frontScore >= 2 && !signals.hasMrz && signals.frontScore >= signals.backScore;
}

function isBackSide(signals) {
  const hasBackSignal = signals.backScore >= 1 || signals.hasMrz;
  return hasBackSignal && (signals.hasMrz || signals.backScore >= signals.frontScore);
}

function extractCccdCandidates(text) {
  if (!text) return [];

  const direct = (String(text).match(/\b\d{12}\b/g) || []).map((v) => v.trim());
  const flexible = Array.from(String(text).matchAll(/(?:\d[\s.\-]*){12}/g))
    .map((m) => normalizeDigits(m[0]))
    .filter((v) => v.length === 12);

  const merged = [...direct, ...flexible];
  if (merged.length > 0) return [...new Set(merged)];

  const allDigits = normalizeDigits(text);
  if (allDigits.length < 12) return [];

  const windows = [];
  for (let i = 0; i <= allDigits.length - 12; i += 1) {
    windows.push(allDigits.substring(i, i + 12));
  }
  return [...new Set(windows)];
}

function getDateKeyInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function increaseCloudFailCounter(db, uid) {
  const ref = db.collection(OCR_FAIL_COUNTERS_COLLECTION).doc(uid);
  const now = Date.now();
  const todayKey = getDateKeyInTimeZone(VN_TIMEZONE);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const currentDateKey = String(data.dateKey || "");
    const currentFailCount = Number(data.failCount || 0);
    const nextFailCount = currentDateKey === todayKey ? currentFailCount + 1 : 1;

    tx.set(ref, {
      dateKey: todayKey,
      failCount: nextFailCount,
      updatedAt: now,
    }, { merge: true });

    return nextFailCount;
  });
}

async function resetCloudFailCounter(db, uid) {
  const ref = db.collection(OCR_FAIL_COUNTERS_COLLECTION).doc(uid);
  await ref.set({
    dateKey: getDateKeyInTimeZone(VN_TIMEZONE),
    failCount: 0,
    updatedAt: Date.now(),
  }, { merge: true });
}

async function readVisionTextFromUrl(imageUrl) {
  const [result] = await getVisionClient().textDetection({
    image: { source: { imageUri: imageUrl } },
  });
  return result?.fullTextAnnotation?.text || "";
}

function isNameMatched(visionText, expectedName) {
  if (!expectedName) return true;
  const normalizedVision = normalizeNoAccentUpper(visionText);
  const normalizedExpected = normalizeNoAccentUpper(expectedName);
  
  if (normalizedVision.includes(normalizedExpected)) return true;
  
  const expectedWords = normalizedExpected.split(/\s+/).filter(Boolean);
  if (expectedWords.length === 0) return true;
  
  let currentIndex = 0;
  for (const word of expectedWords) {
    const foundIndex = normalizedVision.indexOf(word, currentIndex);
    if (foundIndex === -1) return false;
    currentIndex = foundIndex + word.length;
  }
  return true;
}

async function detectCccdByCloudVision(frontUrl, backUrl, expectedCccd, expectedFullName) {
  const [frontText, backText, frontFaceResult] = await Promise.all([
    readVisionTextFromUrl(frontUrl),
    readVisionTextFromUrl(backUrl),
    getVisionClient().faceDetection({ image: { source: { imageUri: frontUrl } } }).catch(e => {
      console.warn("Lỗi faceDetection mặt trước:", e.message);
      return [null];
    }),
  ]);

  const frontSignals = analyzeSideSignals(frontText);
  const backSignals = analyzeSideSignals(backText);
  if (!isFrontSide(frontSignals) || !isBackSide(backSignals)) {
    return {
      passed: false,
      reason: "Hệ thống không thể nhận diện chính xác cả hai mặt của Căn cước công dân.",
      recognizedCccd: "",
    };
  }

  // Bổ sung kiểm tra khuôn mặt trên mặt trước CCCD để tránh ảnh bị cắt cúp
  const frontFaces = frontFaceResult[0]?.faceAnnotations || [];
  if (frontFaces.length === 0) {
    return {
      passed: false,
      reason: "Ảnh mặt trước Căn cước công dân phải hiển thị đầy đủ toàn bộ thẻ, không bị cắt góc và phải nhìn rõ khuôn mặt chủ thẻ.",
      recognizedCccd: "",
    };
  }

  // Bổ sung kiểm duyệt biên giới hạn (Boundary Integrity Check) cho mặt trước thẻ
  const normalizedFront = normalizeNoAccentUpper(frontText);
  // Cải tiến M2: Sử dụng danh sách từ khóa con linh hoạt để giảm thiểu false positive từ lỗi OCR
  const frontTopKeywords = ["CONG HOA", "XA HOI", "DOC LAP", "TU DO", "SOCIALIST", "REPUBLIC", "VIET NAM"];
  const hasTopMotto = frontTopKeywords.some(kw => normalizedFront.includes(kw));

  const frontBottomKeywords = ["THUONG TRU", "CU TRU", "RESIDENCE", "GIA TRI", "EXPIRY", "DEN NGAY", "VALID"];
  const hasBottomResidence = frontBottomKeywords.some(kw => normalizedFront.includes(kw));

  if (!hasTopMotto || !hasBottomResidence) {
    return {
      passed: false,
      reason: "Ảnh mặt trước Căn cước công dân bị cắt xén hoặc không hiển thị đầy đủ tiêu đề quốc hiệu ở phía trên hoặc phần thường trú/hạn dùng ở phía dưới.",
      recognizedCccd: "",
    };
  }

  // Bổ sung kiểm duyệt biên giới hạn (Boundary Integrity Check) cho mặt sau thẻ
  const normalizedBack = normalizeNoAccentUpper(backText);
  const backTopKeywords = ["NHAN DANG", "IDENTIFICATION", "NGAY CAP", "NOI CAP", "DATE OF ISSUE", "SIGNATURE"];
  const hasBackTop = backTopKeywords.some(kw => normalizedBack.includes(kw));

  const backBottomKeywords = ["CUC TRUONG", "DIRECTOR", "GIAM DOC", "CONG AN", "POLICE", "SIGNATURE", "KY TEN"];
  const hasBackBottom = backSignals.hasMrz || backBottomKeywords.some(kw => normalizedBack.includes(kw));

  if (!hasBackTop || !hasBackBottom) {
    return {
      passed: false,
      reason: "Ảnh mặt sau Căn cước công dân bị cắt xén hoặc không hiển thị đầy đủ thông tin đặc điểm nhận dạng ở phía trên hoặc chữ ký/vùng mã máy đọc MRZ ở phía dưới.",
      recognizedCccd: "",
    };
  }

  const candidates = extractCccdCandidates(`${frontText}\n${backText}`);
  const matched = candidates.find((v) => v === expectedCccd);
  if (!matched) {
    if (candidates.length === 0) {
      return {
        passed: false,
        reason: "Hệ thống không thể đọc được số Căn cước công dân 12 chữ số hợp lệ từ ảnh.",
        recognizedCccd: "",
      };
    }
    return {
      passed: false,
      reason: "Hệ thống phát hiện được Căn cước công dân nhưng không khớp với số đã nộp.",
      recognizedCccd: candidates[0],
    };
  }

  if (expectedFullName && !isNameMatched(frontText, expectedFullName)) {
    return {
      passed: false,
      reason: `Số CCCD khớp nhưng Họ và Tên trên thẻ không khớp với tên tài khoản (${expectedFullName}). Vui lòng cập nhật đúng tên thật trên app.`,
      recognizedCccd: matched,
    };
  }

  return {
    passed: true,
    reason: "Hệ thống xác thực thành công số Căn cước công dân và Họ Tên đã nộp.",
    recognizedCccd: matched,
  };
}

exports.autoReviewVerificationByCloudVision = onDocumentWritten("verifications/{uid}", async (event) => {
  const beforeSnap = event.data?.before;
  const afterSnap = event.data?.after;
  if (!afterSnap || !afterSnap.exists) return null;

  const uid = String(event.params.uid || "");
  if (!uid) return null;

  const beforeData = beforeSnap && beforeSnap.exists ? (beforeSnap.data() || {}) : null;
  const data = afterSnap.data() || {};
  const now = Date.now();
  const status = String(data.status || "").trim().toLowerCase();
  if (status !== "pending") return null;

  // Re-run only when entering pending or when user re-submits with changed CCCD/image payload.
  const beforeStatus = String(beforeData?.status || "").trim().toLowerCase();
  const enteredPending = !beforeData || beforeStatus !== "pending";
  const payloadChanged = !beforeData ||
    String(beforeData.cccdNumber || "") !== String(data.cccdNumber || "") ||
    String(beforeData.cccdFrontUrl || "") !== String(data.cccdFrontUrl || "") ||
    String(beforeData.cccdBackUrl || "") !== String(data.cccdBackUrl || "") ||
    String(beforeData.autoCheckStatus || "") !== String(data.autoCheckStatus || "") ||
    Boolean(beforeData.escalatedToAdmin) !== Boolean(data.escalatedToAdmin);

  if (!enteredPending && !payloadChanged) return null;

  const db = admin.firestore();
  const verificationRef = afterSnap.ref;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const currentRole = String(userDoc.data()?.role || "user").toLowerCase();
  const expectedFullName = String(userDoc.data()?.fullName || "").trim();
  const isAdmin = currentRole === "admin";
  const escalatedFromClient = data.escalatedToAdmin === true ||
    String(data.autoCheckStatus || "").trim().toLowerCase() === "failed_escalated";

  async function moveToAdminReview(reason, failCount = AUTO_FAIL_THRESHOLD + 1) {
    const batch = db.batch();
    const notifRef = db.collection("notifications").doc();

    batch.set(verificationRef, {
      status: "pending_admin_review",
      updatedAt: now,
      escalatedToAdmin: true,
      escalationDeadlineAt: Number(data.escalationDeadlineAt) > 0 ? Number(data.escalationDeadlineAt) : (now + DAY_MS),
      autoCheckStatus: "failed_escalated",
      autoCheckReason: reason,
      autoFailCountToday: failCount,
      manualApprovalUnlockImmediately: failCount >= AUTO_FAIL_THRESHOLD + 1,
    }, { merge: true });

    batch.set(userRef, {
      isVerified: false,
      role: isAdmin ? "admin" : "user",
      postingUnlockAt: 0,
    }, { merge: true });

    batch.set(notifRef, {
      userId: uid,
      title: "Hồ sơ đã chuyển admin",
      message: "Hệ thống đã chuyển hồ sơ sang admin để xử lý thủ công trong 24 giờ.",
      type: "verification_pending_admin_review",
      seen: false,
      isRead: false,
      createdAt: now,
    });

    await batch.commit();
  }

  async function rejectVerification(reason, recognizedCccd = "", failCount = 1) {
    const batch = db.batch();
    const rejectNotifRef = db.collection("notifications").doc();

    batch.set(verificationRef, {
      status: "rejected",
      reviewedAt: now,
      reviewedBy: VERIFICATION_REVIEWER_ID,
      updatedAt: now,
      rejectReason: reason,
      autoCheckStatus: "fail_cloud",
      autoCheckReason: reason,
      autoCheckRecognizedCccd: recognizedCccd,
      autoFailCountToday: failCount,
      escalatedToAdmin: false,
      escalationDeadlineAt: 0,
    }, { merge: true });

    batch.set(userRef, {
      isVerified: false,
      role: isAdmin ? "admin" : "user",
      postingUnlockAt: 0,
    }, { merge: true });

    batch.set(rejectNotifRef, {
      userId: uid,
      title: "Xác minh bị từ chối",
      message: "Hệ thống chưa xác thực được ảnh Căn cước công dân của bạn. Vui lòng chụp lại rõ nét và gửi lại.",
      type: "verification_rejected",
      seen: false,
      isRead: false,
      createdAt: now,
    });

    await batch.commit();
  }

  if (escalatedFromClient) {
    const failCount = Math.max(Number(data.autoFailCountToday || 0), AUTO_FAIL_THRESHOLD + 1);
    await moveToAdminReview("Escalated by client after local OCR retries.", failCount);
    return null;
  }

  const expectedCccd = normalizeDigits(data.cccdNumber);
  const frontUrl = String(data.cccdFrontUrl || "").trim();
  const backUrl = String(data.cccdBackUrl || "").trim();

  if (!expectedCccd || expectedCccd.length !== 12 || !frontUrl || !backUrl) {
    const failCount = await increaseCloudFailCounter(db, uid);
    if (failCount > AUTO_FAIL_THRESHOLD) {
      await moveToAdminReview("Cloud Vision input is invalid. Please recapture both CCCD images.", failCount);
      return null;
    }
    await rejectVerification("Cloud Vision input is invalid. Please recapture both CCCD images.", "", failCount);
    return null;
  }

  let cloudResult;
  try {
    cloudResult = await detectCccdByCloudVision(frontUrl, backUrl, expectedCccd, expectedFullName);
  } catch (error) {
    console.error("[autoReviewVerificationByCloudVision] Cloud Vision error:", error);
    await moveToAdminReview("Cloud Vision is temporarily unavailable. Admin review is required.");
    return null;
  }

  if (cloudResult.passed) {
    const batch = db.batch();
    const notifRef = db.collection("notifications").doc();

    batch.set(verificationRef, {
      status: "approved",
      reviewedAt: now,
      reviewedBy: VERIFICATION_REVIEWER_ID,
      updatedAt: now,
      autoCheckStatus: "pass_cloud",
      autoCheckReason: cloudResult.reason,
      autoCheckRecognizedCccd: cloudResult.recognizedCccd || expectedCccd,
      escalatedToAdmin: false,
      escalationDeadlineAt: 0,
    }, { merge: true });

    batch.set(userRef, {
      isVerified: true,
      role: isAdmin ? "admin" : "user",
      postingUnlockAt: 0,
      verifiedAt: now,
    }, { merge: true });

    batch.set(notifRef, {
      userId: uid,
      title: "Xác minh thành công!",
      message: "Hệ thống đã tự động duyệt thông tin của bạn thành công. Bạn có thể đăng bài ngay.",
      type: "verification_approved",
      seen: false,
      isRead: false,
      createdAt: now,
    });

    await batch.commit();
    await resetCloudFailCounter(db, uid);
    return null;
  }

  const failCount = await increaseCloudFailCounter(db, uid);
  if (failCount > AUTO_FAIL_THRESHOLD) {
    await moveToAdminReview(cloudResult.reason, failCount);
    return null;
  }

  await rejectVerification(cloudResult.reason, cloudResult.recognizedCccd || "", failCount);
  return null;
});
