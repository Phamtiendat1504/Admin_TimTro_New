const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const vision = require("@google-cloud/vision");

setGlobalOptions({ maxInstances: 10 });
admin.initializeApp();
const visionClient = new vision.ImageAnnotatorClient();

const CLEANUP = {
  notificationRetentionDays: 60,
  verificationRetentionDays: 180, // only non-pending docs
  systemNotificationRetentionDays: 30,
  maxDocsPerRun: 400,
  maxFilesPerPrefixPerRun: 1200,
};

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
    .toUpperCase();
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
  const [result] = await visionClient.textDetection({
    image: { source: { imageUri: imageUrl } },
  });
  return result?.fullTextAnnotation?.text || "";
}

async function detectCccdByCloudVision(frontUrl, backUrl, expectedCccd) {
  const [frontText, backText] = await Promise.all([
    readVisionTextFromUrl(frontUrl),
    readVisionTextFromUrl(backUrl),
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

  const candidates = extractCccdCandidates(`${frontText}\n${backText}`);
  const matched = candidates.find((v) => v === expectedCccd);
  if (matched) {
    return {
      passed: true,
      reason: "Hệ thống xác thực thành công số Căn cước công dân đã nộp.",
      recognizedCccd: matched,
    };
  }

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

async function batchDeleteRefs(refs) {
  if (!refs || refs.length === 0) return 0;
  const db = admin.firestore();
  let deleted = 0;

  for (let i = 0; i < refs.length; i += 450) {
    const chunk = refs.slice(i, i + 450);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

async function cleanupOldNotifications(now) {
  const db = admin.firestore();
  const cutoff = now - CLEANUP.notificationRetentionDays * DAY_MS;

  const snap = await db.collection("notifications")
    .where("createdAt", "<", cutoff)
    .limit(CLEANUP.maxDocsPerRun)
    .get();

  const deleted = await batchDeleteRefs(snap.docs.map((d) => d.ref));
  return { scanned: snap.size, deleted };
}

async function cleanupOldSystemNotifications(now) {
  const db = admin.firestore();
  const cutoff = now - CLEANUP.systemNotificationRetentionDays * DAY_MS;

  const snap = await db.collection("system_notifications")
    .where("createdAt", "<", cutoff)
    .limit(CLEANUP.maxDocsPerRun)
    .get();

  const deleted = await batchDeleteRefs(snap.docs.map((d) => d.ref));
  return { scanned: snap.size, deleted };
}

async function cleanupOldVerifications(now) {
  const db = admin.firestore();
  const cutoff = now - CLEANUP.verificationRetentionDays * DAY_MS;

  const snap = await db.collection("verifications")
    .where("createdAt", "<", cutoff)
    .limit(CLEANUP.maxDocsPerRun)
    .get();

  const refs = snap.docs
    .filter((d) => (d.get("status") || "pending") !== "pending")
    .map((d) => d.ref);

  const deleted = await batchDeleteRefs(refs);
  return { scanned: snap.size, deleted };
}

async function cleanupOrphanSavedPosts() {
  const db = admin.firestore();
  const snap = await db.collection("savedPosts")
    .limit(CLEANUP.maxDocsPerRun)
    .get();

  const refs = [];
  for (const doc of snap.docs) {
    const roomId = doc.get("roomId");
    const userId = doc.get("userId");

    if (!roomId || !userId) {
      refs.push(doc.ref);
      continue;
    }

    const [roomDoc, userDoc] = await Promise.all([
      db.collection("rooms").doc(String(roomId)).get(),
      db.collection("users").doc(String(userId)).get(),
    ]);

    if (!roomDoc.exists || !userDoc.exists) {
      refs.push(doc.ref);
    }
  }

  const deleted = await batchDeleteRefs(refs);
  return { scanned: snap.size, deleted };
}

async function cleanupOrphanBookedSlots() {
  const db = admin.firestore();
  const snap = await db.collection("bookedSlots")
    .limit(CLEANUP.maxDocsPerRun)
    .get();

  const refs = [];
  for (const doc of snap.docs) {
    // slotId hiện tương ứng appointmentId trong app hiện tại
    const apptDoc = await db.collection("appointments").doc(doc.id).get();
    if (!apptDoc.exists) refs.push(doc.ref);
  }

  const deleted = await batchDeleteRefs(refs);
  return { scanned: snap.size, deleted };
}

async function deleteStorageFilesByPredicate(prefix, shouldDeleteFile) {
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({
    prefix,
    maxResults: CLEANUP.maxFilesPerPrefixPerRun,
    autoPaginate: false,
  });

  let scanned = 0;
  let deleted = 0;

  for (const file of files) {
    scanned += 1;
    try {
      const canDelete = await shouldDeleteFile(file.name);
      if (!canDelete) continue;
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (e) {
      console.warn(`[cleanupStorage:${prefix}] skip ${file.name}:`, e.message || e);
    }
  }

  return { scanned, deleted };
}

async function cleanupOrphanRoomImages() {
  const db = admin.firestore();
  return deleteStorageFilesByPredicate("rooms/", async (fileName) => {
    // rooms/{roomId}/{fileName}
    const parts = String(fileName || "").split("/");
    if (parts.length < 3) return false;
    const roomId = parts[1];
    if (!roomId) return false;
    const roomDoc = await db.collection("rooms").doc(roomId).get();
    return !roomDoc.exists;
  });
}

async function cleanupOrphanVerificationImages() {
  const db = admin.firestore();
  return deleteStorageFilesByPredicate("verifications/", async (fileName) => {
    // verifications/{uid}/{fileName}
    const parts = String(fileName || "").split("/");
    if (parts.length < 3) return false;
    const uid = parts[1];
    if (!uid) return false;
    const verifyDoc = await db.collection("verifications").doc(uid).get();
    return !verifyDoc.exists;
  });
}

async function cleanupOrphanAvatars() {
  const db = admin.firestore();
  return deleteStorageFilesByPredicate("avatars/", async (fileName) => {
    // path có thể là avatars/{uid} hoặc avatars/{uid}/...
    const path = String(fileName || "").replace(/^avatars\//, "");
    if (!path) return false;
    const uid = path.split("/")[0];
    if (!uid) return false;
    const userDoc = await db.collection("users").doc(uid).get();
    return !userDoc.exists;
  });
}

async function cleanupOrphanChatImages() {
  const db = admin.firestore();
  return deleteStorageFilesByPredicate("chat_images/", async (fileName) => {
    // chat_images/{chatId}/{fileName}
    const parts = String(fileName || "").split("/");
    if (parts.length < 3) return false;
    const chatId = parts[1];
    if (!chatId) return false;
    const chatDoc = await db.collection("chats").doc(chatId).get();
    return !chatDoc.exists;
  });
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
    cloudResult = await detectCccdByCloudVision(frontUrl, backUrl, expectedCccd);
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

exports.autoUnlockUsers = onSchedule("every 1 mins", async () => {
  const now = Date.now();
  const db = admin.firestore();

  try {
    const expiredUsers = await db
      .collection("users")
      .where("isLocked", "==", true)
      .where("lockUntil", "<=", now)
      .get();

    if (expiredUsers.empty) return null;

    const batch = db.batch();
    expiredUsers.forEach((doc) => {
      batch.update(doc.ref, {
        isLocked: false,
        lockReason: "",
        lockUntil: 0,
        unlockedAt: now,
        unlockedBy: "system_auto",
      });

      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        userId: doc.id,
        title: "Tài khoản đã được mở khóa",
        message: "Chào mừng bạn quay trở lại! Thời gian tạm khóa của bạn đã kết thúc.",
        type: "account_unlocked",
        seen: false,
        isRead: false,
        createdAt: now,
      });
    });

    await batch.commit();
    console.log(`Đã tự động mở khóa ${expiredUsers.size} tài khoản.`);
  } catch (error) {
    console.error("Lỗi tự động mở khóa:", error);
  }

  return null;
});

exports.dailyDataCleanup = onSchedule(
  { schedule: "every day 03:20", timeZone: "Asia/Ho_Chi_Minh" },
  async () => {
    const now = Date.now();
    const results = {};

    try {
      results.notifications = await cleanupOldNotifications(now);
      results.systemNotifications = await cleanupOldSystemNotifications(now);
      results.verifications = await cleanupOldVerifications(now);
      results.savedPosts = await cleanupOrphanSavedPosts();
      results.bookedSlots = await cleanupOrphanBookedSlots();

      // Storage orphan cleanup
      results.storageRooms = await cleanupOrphanRoomImages();
      results.storageVerifications = await cleanupOrphanVerificationImages();
      results.storageAvatars = await cleanupOrphanAvatars();
      results.storageChatImages = await cleanupOrphanChatImages();

      console.log("[dailyDataCleanup] done:", results);
    } catch (error) {
      console.error("[dailyDataCleanup] failed:", error);
    }

    return null;
  }
);

exports.deleteUserAccount = onRequest(async (req, res) => {
  return cors(req, res, async () => {
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).send({ error: "Method Not Allowed" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const callerUid = decodedToken.uid;

      const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
      if (!callerDoc.exists || callerDoc.data().role !== "admin") {
        return res.status(403).send({ error: "Quyền truy cập bị từ chối" });
      }

      const { uid } = req.body || {};
      if (!uid || typeof uid !== "string") {
        return res.status(400).send({ error: "Thiếu UID người dùng hợp lệ" });
      }

      if (uid === callerUid) {
        return res.status(400).send({ error: "Không thể tự xóa tài khoản admin đang đăng nhập" });
      }

      try {
        await admin.auth().deleteUser(uid);
        console.log(`Đã xóa thành công tài khoản Auth: ${uid}`);
        return res.status(200).send({ message: "Đã xóa tài khoản khỏi Authentication thành công" });
      } catch (authError) {
        if (authError.code === "auth/user-not-found") {
          console.warn(`User ${uid} không tồn tại trong Firebase Auth.`);
          return res.status(200).send({ message: "User không tồn tại trong Authentication, bỏ qua." });
        }
        throw authError;
      }
    } catch (error) {
      console.error("Lỗi khi xóa tài khoản:", error);
      return res.status(500).send({ error: error.message });
    }
  });
});

exports.sendPushNotification = onDocumentCreated("notifications/{notifId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const userId = data.userId;
  const title = data.title || "Thông báo mới";
  const body = data.message || "";

  if (!userId) {
    console.log("Không có userId trong notification, bỏ qua.");
    return;
  }

  try {
    const userDoc = await admin.firestore().collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.log(`Không tìm thấy user: ${userId}`);
      return;
    }

    const fcmToken = userDoc.data()?.fcmToken;
    if (!fcmToken) {
      console.log(`User ${userId} chưa có FCM Token, bỏ qua.`);
      return;
    }

    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "fcm_notification_channel",
        },
      },
      data: {
        type: data.type || "general",
        userId,
        chatId: data.chatId || "",
        senderId: data.senderId || "",
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`Gửi thông báo thành công tới ${userId}: ${response}`);
  } catch (error) {
    console.error(`Lỗi gửi thông báo tới ${userId}:`, error);
  }
});

// Slot upgrade payment automation via SePay
const { defineSecret } = require("firebase-functions/params");
const sepayApiToken = defineSecret("SEPAY_API_TOKEN");
const SEPAY_TRANSACTIONS_API = "https://my.sepay.vn/userapi/transactions/list";
const SLOT_UPGRADE_EXPIRE_MS = 30 * 60 * 1000;
const SLOT_UPGRADE_SCAN_LIMIT = 200;

function normalizeSePayContent(raw) {
  // Normalize for loose matching: remove spaces + punctuation differences
  // (bank/sepay có thể bỏ "_" hoặc thêm ký tự phân tách).
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractRequestCode(raw) {
  // Match REQ_ABCDEFGH, REQ-ABCDEFGH, REQ ABCDEFGH, REQABCDEFGH
  const text = String(raw || "").toUpperCase();
  const m = text.match(/REQ[_\-\s]*([A-Z0-9]{8})/);
  return m ? m[1] : "";
}

function parseSePayAmount(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : 0;
  const text = String(raw || "").trim();
  if (!text) return 0;

  // Ưu tiên lấy chuỗi số thuần để tránh lỗi locale 10.000 / 10,000 / 10 000 đ
  const digits = text.replace(/[^\d]/g, "");
  if (digits) {
    const parsedInt = Number.parseInt(digits, 10);
    return Number.isFinite(parsedInt) ? parsedInt : 0;
  }

  const normalized = text.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function extractSePayTxId(tx) {
  return String(
    tx?.id ||
    tx?.transaction_id ||
    tx?.reference_id ||
    tx?.transaction_reference ||
    tx?.reference ||
    tx?.code ||
    ""
  ).trim();
}

function pickSePayContent(tx) {
  return String(
    tx?.transaction_content ||
    tx?.content ||
    tx?.description ||
    tx?.transferContent ||
    tx?.remark ||
    tx?.memo ||
    ""
  );
}

async function fetchSePayTransactions(token) {
  const res = await fetch(SEPAY_TRANSACTIONS_API, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SePay API failed (${res.status}): ${body}`);
  }

  const payload = await res.json();
  const list = Array.isArray(payload?.transactions)
    ? payload.transactions
    : Array.isArray(payload?.data?.transactions)
      ? payload.data.transactions
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return list.map((tx) => ({
    txId: extractSePayTxId(tx),
    amountIn: parseSePayAmount(
      tx?.amount_in ??
      tx?.amountIn ??
      tx?.amount_in_value ??
      tx?.amountValue ??
      tx?.in_amount ??
      tx?.credit ??
      tx?.amount ??
      tx?.amount_in_text
    ),
    content: normalizeSePayContent(pickSePayContent(tx)),
    rawContent: pickSePayContent(tx),
  }));
}

exports.processPendingSlotUpgradePayments = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Asia/Ho_Chi_Minh", secrets: [sepayApiToken] },
  async () => {
    const token = String(sepayApiToken.value() || "").trim();
    if (!token) {
      console.error("[processPendingSlotUpgradePayments] Missing SEPAY_API_TOKEN secret.");
      return null;
    }

    const db = admin.firestore();
    const now = Date.now();

    const waitingSnap = await db.collection("slot_upgrade_requests")
      .where("status", "==", "waiting_for_payment")
      .limit(SLOT_UPGRADE_SCAN_LIMIT)
      .get();

    if (waitingSnap.empty) return null;

    let transactions = [];
    try {
      transactions = await fetchSePayTransactions(token);
    } catch (error) {
      console.error("[processPendingSlotUpgradePayments] Cannot fetch SePay transactions:", error);
      return null;
    }

    for (const doc of waitingSnap.docs) {
      const data = doc.data() || {};
      const createdAt = Number(data.createdAt || 0);
      const expiresAt = Number(data.expiresAt || (createdAt > 0 ? createdAt + SLOT_UPGRADE_EXPIRE_MS : 0));
      const expectedAmount = Number(data.amount || 0);
      const expectedNote = normalizeSePayContent(data.transferNote);
      const expectedRequestCode = extractRequestCode(data.transferNote);

      if (!expectedNote || expectedAmount <= 0) {
        continue;
      }

      if (expiresAt > 0 && now > expiresAt) {
        await doc.ref.set({
          status: "expired",
          expiredAt: now,
          updatedAt: now,
        }, { merge: true });
        continue;
      }

      const matchedTx = transactions.find((tx) => {
        const txRequestCode = extractRequestCode(tx.rawContent || "");

        // Ưu tiên match theo REQ code (độc nhất cho từng request).
        if (expectedRequestCode && txRequestCode) {
          return txRequestCode === expectedRequestCode;
        }

        // Fallback 1: vẫn có thể match bằng request code nằm trong chuỗi đã normalize.
        if (expectedRequestCode && tx.content.includes(`req${expectedRequestCode.toLowerCase()}`)) {
          return true;
        }

        // Fallback legacy: amount + note
        if (tx.amountIn !== expectedAmount) return false;
        return tx.content.includes(expectedNote);
      });

      if (!matchedTx) {
        console.log("[processPendingSlotUpgradePayments] no match", {
          requestId: doc.id,
          expectedAmount,
          expectedRequestCode,
          expectedNote,
          txSample: transactions.slice(0, 5).map((t) => ({
            txId: t.txId,
            amountIn: t.amountIn,
            requestCode: extractRequestCode(t.rawContent || ""),
            rawContent: t.rawContent,
          })),
        });
      }
      if (!matchedTx) continue;

      const uid = String(data.uid || "").trim();
      const slots = Number(data.slots || 0);
      if (!uid || slots <= 0) {
        await doc.ref.set({
          status: "failed",
          failReason: "invalid_request_payload",
          updatedAt: now,
        }, { merge: true });
        continue;
      }

      const userRef = db.collection("users").doc(uid);
      const notifRef = db.collection("notifications").doc();

      await db.runTransaction(async (tx) => {
        const freshReqSnap = await tx.get(doc.ref);
        if (!freshReqSnap.exists) return;

        const freshReq = freshReqSnap.data() || {};
        if (String(freshReq.status || "") !== "waiting_for_payment") {
          return;
        }

        const freshCreatedAt = Number(freshReq.createdAt || 0);
        const freshExpiresAt = Number(freshReq.expiresAt || (freshCreatedAt > 0 ? freshCreatedAt + SLOT_UPGRADE_EXPIRE_MS : 0));
        if (freshExpiresAt > 0 && now > freshExpiresAt) {
          tx.set(doc.ref, {
            status: "expired",
            expiredAt: now,
            updatedAt: now,
          }, { merge: true });
          return;
        }

        const userSnap = await tx.get(userRef);
        const currentSlots = Number(userSnap.data()?.purchasedSlots || 0);
        const expectedFreshAmount = Number(freshReq.amount || 0);
        if (expectedFreshAmount <= 0 || matchedTx.amountIn !== expectedFreshAmount) {
          tx.set(doc.ref, {
            status: "failed",
            failReason: "amount_mismatch",
            updatedAt: now,
            paidAmount: matchedTx.amountIn,
            paidContent: matchedTx.rawContent,
          }, { merge: true });
          return;
        }

        tx.set(doc.ref, {
          status: "paid",
          paidAt: now,
          updatedAt: now,
          paymentProvider: "sepay",
          providerTxId: matchedTx.txId,
          paidAmount: matchedTx.amountIn,
          paidContent: matchedTx.rawContent,
        }, { merge: true });

        tx.set(userRef, {
          purchasedSlots: currentSlots + slots,
        }, { merge: true });

        tx.set(notifRef, {
          userId: uid,
          title: "Nạp lượt thành công",
          message: `Bạn đã được cộng thêm ${slots} lượt đăng bài.`,
          type: "slot_upgrade_paid",
          seen: false,
          isRead: false,
          createdAt: now,
        });
      });
    }

    return null;
  }
);

exports.processPendingFeaturedUpgradePayments = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Asia/Ho_Chi_Minh", secrets: [sepayApiToken] },
  async () => {
    const token = String(sepayApiToken.value() || "").trim();
    if (!token) {
      console.error("[processPendingFeaturedUpgradePayments] Missing SEPAY_API_TOKEN secret.");
      return null;
    }

    const db = admin.firestore();
    const now = Date.now();
    const waitingSnap = await db.collection("featured_upgrade_requests")
      .where("status", "==", "waiting_for_payment")
      .limit(SLOT_UPGRADE_SCAN_LIMIT)
      .get();

    if (waitingSnap.empty) return null;

    let transactions = [];
    try {
      transactions = await fetchSePayTransactions(token);
    } catch (error) {
      console.error("[processPendingFeaturedUpgradePayments] Cannot fetch SePay transactions:", error);
      return null;
    }

    for (const doc of waitingSnap.docs) {
      const data = doc.data() || {};
      const createdAt = Number(data.createdAt || 0);
      const expiresAt = Number(data.expiresAt || (createdAt > 0 ? createdAt + SLOT_UPGRADE_EXPIRE_MS : 0));
      const expectedAmount = Number(data.amount || 0);
      const expectedNote = normalizeSePayContent(data.transferNote);
      const expectedRequestCode = extractRequestCode(data.transferNote);

      if (!expectedNote || expectedAmount <= 0) continue;

      if (expiresAt > 0 && now > expiresAt) {
        await doc.ref.set({
          status: "expired",
          approvalStatus: "expired",
          expiredAt: now,
          updatedAt: now,
        }, { merge: true });
        continue;
      }

      const matchedTx = transactions.find((tx) => {
        const txRequestCode = extractRequestCode(tx.rawContent || "");
        if (expectedRequestCode && txRequestCode) return txRequestCode === expectedRequestCode;
        if (expectedRequestCode && tx.content.includes(`req${expectedRequestCode.toLowerCase()}`)) return true;
        if (tx.amountIn !== expectedAmount) return false;
        return tx.content.includes(expectedNote);
      });
      if (!matchedTx) continue;

      const uid = String(data.uid || "").trim();
      const roomId = String(data.roomId || "").trim();
      const days = Number(data.days || 0);
      if (!uid || !roomId || days <= 0) {
        await doc.ref.set({
          status: "failed",
          failReason: "invalid_request_payload",
          updatedAt: now,
        }, { merge: true });
        continue;
      }

      const roomRef = db.collection("rooms").doc(roomId);
      const notifRef = db.collection("notifications").doc();

      await db.runTransaction(async (tx) => {
        const freshReqSnap = await tx.get(doc.ref);
        if (!freshReqSnap.exists) return;
        const freshReq = freshReqSnap.data() || {};
        if (String(freshReq.status || "") !== "waiting_for_payment") return;

        const freshCreatedAt = Number(freshReq.createdAt || 0);
        const freshExpiresAt = Number(freshReq.expiresAt || (freshCreatedAt > 0 ? freshCreatedAt + SLOT_UPGRADE_EXPIRE_MS : 0));
        if (freshExpiresAt > 0 && now > freshExpiresAt) {
          tx.set(doc.ref, {
            status: "expired",
            approvalStatus: "expired",
            expiredAt: now,
            updatedAt: now,
          }, { merge: true });
          return;
        }

        const expectedFreshAmount = Number(freshReq.amount || 0);
        if (expectedFreshAmount <= 0 || matchedTx.amountIn !== expectedFreshAmount) {
          tx.set(doc.ref, {
            status: "failed",
            failReason: "amount_mismatch",
            updatedAt: now,
            paidAmount: matchedTx.amountIn,
            paidContent: matchedTx.rawContent,
          }, { merge: true });
          return;
        }

        tx.set(doc.ref, {
          status: "paid_waiting_admin",
          approvalStatus: "pending_admin",
          paidAt: now,
          updatedAt: now,
          paymentProvider: "sepay",
          providerTxId: matchedTx.txId,
          paidAmount: matchedTx.amountIn,
          paidContent: matchedTx.rawContent,
        }, { merge: true });

        tx.set(roomRef, {
          featuredRequestId: doc.id,
          featuredRequestStatus: "paid_waiting_admin",
        }, { merge: true });

        tx.set(notifRef, {
          userId: uid,
          title: "Đã thanh toán gói nổi bật",
          message: "Yêu cầu đẩy bài nổi bật đã được ghi nhận và đang chờ admin duyệt.",
          type: "featured_upgrade_paid",
          seen: false,
          isRead: false,
          createdAt: now,
        });
      });
    }

    return null;
  }
);

exports.autoDisableExpiredFeaturedRooms = onSchedule(
  { schedule: "every 30 minutes", timeZone: "Asia/Ho_Chi_Minh" },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const snap = await db.collection("rooms")
      .where("isFeatured", "==", true)
      .where("featuredUntil", "<=", now)
      .limit(200)
      .get();

    if (snap.empty) return null;

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.set(doc.ref, {
        isFeatured: false,
        featuredRequestStatus: "expired",
        featuredExpiredAt: now,
      }, { merge: true });
    });
    await batch.commit();
    return null;
  }
);
