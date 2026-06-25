const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated, onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const functionsV1 = require("firebase-functions/v1");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

setGlobalOptions({ maxInstances: 10, region: "asia-southeast1" });
admin.initializeApp();

const cachedAdmins = new Map();
const ADMIN_CACHE_TTL = 60000;
const ADMIN_CACHE_MAX = 50;

exports.getDashboardStats = onCall({ cors: true, maxInstances: 2 }, async (request) => {
  // H5: Admin authorization check
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Yêu cầu đăng nhập');
  }
  
  const callerUid = request.auth.uid;
  const now = Date.now();
  
  let isCallerAdmin = false;
  if (cachedAdmins.has(callerUid) && (now - cachedAdmins.get(callerUid) < ADMIN_CACHE_TTL)) {
    isCallerAdmin = true;
  } else {
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    if (callerDoc.exists && callerDoc.data()?.role === 'admin') {
      isCallerAdmin = true;
      if (cachedAdmins.size >= ADMIN_CACHE_MAX) cachedAdmins.clear();
      cachedAdmins.set(callerUid, now);
    }
  }

  if (!isCallerAdmin) {
    throw new HttpsError('permission-denied', 'Chỉ admin mới có quyền xem thống kê');
  }

  const db = admin.firestore();
  
  // Read shared cached stats from Firestore (resolves H2 multi-instance cache sharing)
  let statsDoc = null;
  try {
    statsDoc = await db.collection('stats').doc('dashboard_stats').get();
  } catch (e) {
    console.warn("Lỗi đọc cache stats từ Firestore, sẽ tính toán lại:", e.message);
  }

  if (statsDoc && statsDoc.exists) {
    const data = statsDoc.data();
    if (data && data.updatedAt && (now - data.updatedAt < 300000)) {
      return data.stats;
    }
  }

  // Tối ưu hóa: Dùng .count() API của Firebase Admin để lấy tổng số cực rẻ (1 Read) thay vì tải toàn bộ
  const [totalUsersSnap, totalRoomsSnap] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('rooms').count().get()
  ]);

  // Kéo data để vẽ Chart (Sử dụng .select để tránh lỗi OOM do tràn RAM khi dữ liệu lớn)
  const [allUsersSnap, allRoomsSnap] = await Promise.all([
    db.collection('users').select('role', 'isVerified').get(),
    db.collection('rooms').select('createdAt').get()
  ]);

  const userDocs = allUsersSnap.docs.map(d => d.data());
  const roomDocs = allRoomsSnap.docs.map(d => d.data());

  const userGroups = { standard: 0, verified: 0, admin: 0 };
  userDocs.forEach(d => {
    if (d.role === 'admin') userGroups.admin++;
    else if (d.isVerified === true) userGroups.verified++;
    else userGroups.standard++;
  });

  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  const last6Months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    last6Months.push({ month: d.getMonth(), year: d.getFullYear(), label: monthNames[d.getMonth()], count: 0 });
  }

  roomDocs.forEach(data => {
    if (!data.createdAt) return;
    
    let createdAtMs = 0;
    if (typeof data.createdAt === 'number') {
      createdAtMs = data.createdAt;
    } else if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
      createdAtMs = data.createdAt.toMillis();
    } else if (data.createdAt instanceof Date) {
      createdAtMs = data.createdAt.getTime();
    } else {
      return; 
    }
    
    if (!createdAtMs) return;
    
    const d = new Date(createdAtMs);
    const m = d.getMonth();
    const y = d.getFullYear();
    const target = last6Months.find(item => item.month === m && item.year === y);
    if (target) target.count++;
  });

  const newStats = {
    totalUsers: totalUsersSnap.data().count,
    totalRooms: totalRoomsSnap.data().count,
    userGroups,
    postsChart: last6Months
  };

  try {
    await db.collection('stats').doc('dashboard_stats').set({
      stats: newStats,
      updatedAt: now
    });
  } catch (e) {
    console.warn("Lỗi ghi cache stats vào Firestore:", e.message);
  }

  return newStats;
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

exports.deleteUserAccount = onRequest({ invoker: "public" }, async (req, res) => {
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

      const { uid } = req.body || {};
      if (!uid || typeof uid !== "string") {
        return res.status(400).send({ error: "Thiếu UID người dùng hợp lệ" });
      }

      const db = admin.firestore();
      const callerDoc = await db.collection("users").doc(callerUid).get();
      const isAdmin = callerDoc.exists && callerDoc.data().role === "admin";
      const isSelfDelete = (callerUid === uid);

      // Cho phép: Admin xóa người khác, hoặc user tự xóa tài khoản của chính mình
      if (!isAdmin && !isSelfDelete) {
        return res.status(403).send({ error: "Quyền truy cập bị từ chối." });
      }

      if (isAdmin && callerUid === uid) {
        return res.status(400).send({ error: "Không thể tự xóa tài khoản admin đang đăng nhập" });
      }

      // M1 Fix: Mask UID to protect PII in system logs
      console.log(`Bắt đầu quy trình xóa cascade cho user UID: ${uid.slice(0, 8)}...`);

      // 1. Đọc SĐT từ document user
      let phoneFromUser = "";
      try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) {
          const ud = userDoc.data() || {};
          phoneFromUser = String(ud.phone || ud.phoneNumber || "").trim();
        }
      } catch (err) {
        console.warn(`Lỗi đọc SĐT của user ${uid.slice(0, 8)}...:`, err.message);
      }

      // 2. Đọc số CCCD từ document verification
      let cccdFromVerification = "";
      try {
        const verifyDoc = await db.collection("verifications").doc(uid).get();
        if (verifyDoc.exists) {
          const vd = verifyDoc.data() || {};
          cccdFromVerification = String(vd.cccdNumber || "").trim();
        }
      } catch (err) {
        console.warn(`Lỗi đọc số CCCD của user ${uid.slice(0, 8)}...:`, err.message);
      }

      const refsToDelete = [];

      // A. Gom users/{uid}, verifications/{uid} và verification_counters/{uid}
      refsToDelete.push(db.collection("users").doc(uid));
      refsToDelete.push(db.collection("verifications").doc(uid));
      refsToDelete.push(db.collection("verification_counters").doc(uid));

      // B. Gom rooms owned by user
      const roomsSnap = await db.collection("rooms").where("userId", "==", uid).get();
      const roomIds = [];
      roomsSnap.forEach(doc => {
        refsToDelete.push(doc.ref);
        roomIds.push(doc.id);
      });

      // C. Gom savedPosts
      const savedPostsSnap = await db.collection("savedPosts").where("userId", "==", uid).get();
      savedPostsSnap.forEach(doc => refsToDelete.push(doc.ref));

      // D. Gom notifications
      const notificationsSnap = await db.collection("notifications").where("userId", "==", uid).get();
      notificationsSnap.forEach(doc => refsToDelete.push(doc.ref));

      // F. Gom appointments (của tenant hoặc landlord)
      const apptsTenantSnap = await db.collection("appointments").where("tenantId", "==", uid).get();
      const apptIds = new Set();
      apptsTenantSnap.forEach(doc => {
        refsToDelete.push(doc.ref);
        apptIds.add(doc.id);
      });
      const apptsLandlordSnap = await db.collection("appointments").where("landlordId", "==", uid).get();
      apptsLandlordSnap.forEach(doc => {
        refsToDelete.push(doc.ref);
        apptIds.add(doc.id);
      });

      // G. Gom bookedSlots dựa trên các cuộc hẹn đã tìm thấy
      // BUG FIX: bookedSlots ID là roomId_date_time chứ không phải apptId
      for (const doc of apptsTenantSnap.docs) {
        const d = doc.data();
        if (d.roomId && d.appointmentDate && d.appointmentTime) {
            const slotId = `${d.roomId}_${d.appointmentDate}_${d.appointmentTime}`.replace(/\//g, "-").replace(/:/g, "-").replace(/ /g, "_");
            refsToDelete.push(db.collection("bookedSlots").doc(slotId));
        }
      }
      for (const doc of apptsLandlordSnap.docs) {
        const d = doc.data();
        if (d.roomId && d.appointmentDate && d.appointmentTime) {
            const slotId = `${d.roomId}_${d.appointmentDate}_${d.appointmentTime}`.replace(/\//g, "-").replace(/:/g, "-").replace(/ /g, "_");
            refsToDelete.push(db.collection("bookedSlots").doc(slotId));
        }
      }

      // H. Gom slot_upgrade_requests và featured_upgrade_requests
      const slotReqSnap = await db.collection("slot_upgrade_requests").where("uid", "==", uid).get();
      slotReqSnap.forEach(doc => refsToDelete.push(doc.ref));

      const featuredReqSnap = await db.collection("featured_upgrade_requests").where("uid", "==", uid).get();
      featuredReqSnap.forEach(doc => refsToDelete.push(doc.ref));

      // I. Gom support_tickets
      const supportSnap = await db.collection("support_tickets").where("userId", "==", uid).get();
      supportSnap.forEach(doc => refsToDelete.push(doc.ref));

      // J. Gom room_reports (báo cáo do user tạo hoặc liên quan đến phòng của user)
      const reportsSnap = await db.collection("room_reports").where("reporterId", "==", uid).get();
      reportsSnap.forEach(doc => refsToDelete.push(doc.ref));

      // K. Gom registry tài khoản (CCCD và SĐT) theo query
      const phoneRegSnap = await db.collection("phone_registry").where("uid", "==", uid).get();
      phoneRegSnap.forEach(doc => refsToDelete.push(doc.ref));

      const cccdRegSnap = await db.collection("cccd_registry").where("uid", "==", uid).get();
      cccdRegSnap.forEach(doc => refsToDelete.push(doc.ref));

      // L. Gom registry theo document ID trực tiếp
      if (phoneFromUser) {
        refsToDelete.push(db.collection("phone_registry").doc(phoneFromUser));
      }
      if (cccdFromVerification) {
        refsToDelete.push(db.collection("cccd_registry").doc(cccdFromVerification));
      }

      // Loại bỏ các document trùng lặp để tối ưu hóa batch delete
      const uniqueRefs = [];
      const seenPaths = new Set();
      refsToDelete.forEach(ref => {
        const path = ref.path;
        if (!seenPaths.has(path)) {
          seenPaths.add(path);
          uniqueRefs.push(ref);
        }
      });

      // Thực hiện xóa tài liệu trong Firestore theo các batch 500 tài liệu
      console.log(`Đang tiến hành xóa ${uniqueRefs.length} tài liệu Firestore liên quan...`);
      for (let i = 0; i < uniqueRefs.length; i += 500) {
        const chunk = uniqueRefs.slice(i, i + 500);
        const batch = db.batch();
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
      }

      // Xóa tệp Cloud Storage tương ứng
      console.log(`Đang tiến hành dọn dẹp thư mục ảnh trong Cloud Storage...`);
      const bucket = admin.storage().bucket();
      const storagePromises = [];

      storagePromises.push(bucket.deleteFiles({ prefix: `avatars/${uid}` }).catch(e => console.warn(`Không thể dọn dẹp avatars/${uid.slice(0, 8)}...:`, e.message)));
      storagePromises.push(bucket.deleteFiles({ prefix: `verifications/${uid}` }).catch(e => console.warn(`Không thể dọn dẹp verifications/${uid.slice(0, 8)}...:`, e.message)));
      
      for (const roomId of roomIds) {
        storagePromises.push(bucket.deleteFiles({ prefix: `rooms/${roomId}` }).catch(e => console.warn(`Không thể dọn dẹp rooms/${roomId}:`, e.message)));
      }

      const storageResults = await Promise.allSettled(storagePromises);

      // Cải tiến 1: Phân tích trạng thái dọn dẹp Cloud Storage
      const storageCleanupLog = storageResults.map((result, idx) => {
        let prefix = "";
        if (idx === 0) prefix = `avatars/${uid.slice(0, 8)}...`;
        else if (idx === 1) prefix = `verifications/${uid.slice(0, 8)}...`;
        else prefix = `rooms/${roomIds[idx - 2]}`;
        
        return {
          prefix,
          status: result.status,
          reason: result.status === "rejected" ? String(result.reason || result.reason?.message || "Unknown error") : null
        };
      });
      console.log(`Kết quả dọn dẹp Cloud Storage cho UID ${uid.slice(0, 8)}...:`, JSON.stringify(storageCleanupLog));

      // Cuối cùng, xóa tài khoản khỏi Firebase Authentication
      console.log(`Đang tiến hành xóa tài khoản khỏi Firebase Auth...`);
      try {
        await admin.auth().deleteUser(uid);
        console.log(`Đã xóa tài khoản Auth thành công cho UID: ${uid.slice(0, 8)}...`);
      } catch (authError) {
        if (authError.code === "auth/user-not-found") {
          console.warn(`User ${uid.slice(0, 8)}... không tồn tại trong Firebase Auth, bỏ qua bước này.`);
        } else {
          throw authError;
        }
      }

      // Ghi nhật ký kiểm toán (Audit Log) — che PII, chỉ lưu 4 số cuối
      const maskPii = (val) => val ? `****${String(val).slice(-4)}` : "N/A";
      try {
        const adminName = callerDoc.data()?.fullName || callerDoc.data()?.email || "Admin";
        await db.collection("admin_logs").add({
          actorId: callerUid,
          actorName: adminName,
          action: "DELETE_USER_ACCOUNT",
          targetId: uid,
          targetPhone: maskPii(phoneFromUser),
          targetCccd: maskPii(cccdFromVerification),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          details: `Xóa tài khoản UID: ${uid.slice(0, 8)}... SĐT: ${maskPii(phoneFromUser)}. CCCD: ${maskPii(cccdFromVerification)}. Đã dọn dẹp ${roomIds.length} phòng. Bộ nhớ: ${JSON.stringify(storageCleanupLog)}`
        });
        console.log(`Đã ghi Audit Log thành công cho hành động xóa tài khoản user UID: ${uid.slice(0, 8)}...`);
      } catch (logErr) {
        console.error("Lỗi khi ghi Audit Log xóa tài khoản:", logErr);
      }

      console.log(`Hoàn thành quy trình xóa tài khoản thành công cho user UID: ${uid.slice(0, 8)}...`);
      return res.status(200).send({ message: "Đã xóa tài khoản và toàn bộ dữ liệu liên quan thành công" });

    } catch (error) {
      console.error("Lỗi nghiêm trọng trong quy trình xóa tài khoản:", error);
      return res.status(500).send({ error: "Lỗi hệ thống, vui lòng thử lại sau." });
    }
  });
});

exports.updatePopularAreasStats = onDocumentWritten("rooms/{roomId}", async (event) => {
  const beforeData = event.data?.before?.exists ? event.data.before.data() : null;
  const afterData = event.data?.after?.exists ? event.data.after.data() : null;

  const beforeStatus = beforeData ? beforeData.status : null;
  const afterStatus = afterData ? afterData.status : null;
  
  const beforeDistrict = beforeData ? (beforeData.district || "").trim() : "";
  const afterDistrict = afterData ? (afterData.district || "").trim() : "";

  if (beforeStatus !== 'approved' && afterStatus !== 'approved') return null;
  if (beforeStatus === 'approved' && afterStatus === 'approved' && beforeDistrict === afterDistrict) return null;

  const db = admin.firestore();
  
  const allApprovedSnap = await db.collection("rooms").where("status", "==", "approved").get();
  
  const districtCount = {};
  const districtDisplay = {};

  allApprovedSnap.docs.forEach(doc => {
    const rawDistrict = doc.data().district || "";
    const district = rawDistrict.trim().replace(/\s+/g, " ");
    if (!district) return;
    
    const key = district.toLowerCase();
    districtCount[key] = (districtCount[key] || 0) + 1;
    if (!districtDisplay[key]) districtDisplay[key] = district;
  });

  const popularAreas = Object.keys(districtCount)
    .map(key => ({ district: districtDisplay[key], count: districtCount[key] }))
    .sort((a, b) => b.count - a.count);

  await db.collection("stats").doc("popular_areas").set({ areas: popularAreas, updatedAt: Date.now() });
  return null;
});

// ?? Sub-module exports ?????????????????????????????????????????????????
const verification = require('./functions/verification');
exports.autoReviewVerificationByCloudVision = verification.autoReviewVerificationByCloudVision;


// Dọn dẹp dữ liệu khi user bị xóa khỏi Firebase Auth
exports.onUserDeleted = functionsV1.auth.user().onDelete(async (user) => {
  const db = admin.firestore();
  const uid = user.uid;
  try {
    await db.collection('users').doc(uid).delete();

    const [notifSnap, apptSnap, savedSnap] = await Promise.all([
      db.collection('notifications').where('userId', '==', uid).get(),
      db.collection('appointments').where('tenantId', '==', uid).where('status', '==', 'pending').get(),
      db.collection('savedPosts').where('userId', '==', uid).get(),
    ]);

    const chunks = (docs) => {
      const result = [];
      for (let i = 0; i < docs.length; i += 450) result.push(docs.slice(i, i + 450));
      return result;
    };

    const commitBatch = async (docs, fn) => {
      for (const chunk of chunks(docs)) {
        const b = db.batch();
        chunk.forEach(d => fn(b, d));
        await b.commit();
      }
    };

    await Promise.all([
      commitBatch(notifSnap.docs, (b, d) => b.delete(d.ref)),
      commitBatch(apptSnap.docs, (b, d) => b.update(d.ref, { status: 'cancelled_by_system' })),
      commitBatch(savedSnap.docs, (b, d) => b.delete(d.ref)),
    ]);

    console.log(`[onUserDeleted] cleaned up data for uid=${uid}`);
  } catch (e) {
    console.error(`[onUserDeleted] error for uid=${uid}:`, e);
  }
});

// Dọn dẹp dữ liệu liên quan khi phòng bị xóa (an toàn lưới cho trường hợp Android cleanup bị gián đoạn)
exports.onRoomDeleted = onDocumentDeleted('rooms/{roomId}', async (event) => {
  const roomId = event.params.roomId;
  const roomData = event.data ? event.data.data() : {};
  const roomTitle = roomData.title || 'Phòng trọ';
  const db = admin.firestore();

  const chunks = (docs) => {
    const result = [];
    for (let i = 0; i < docs.length; i += 450) result.push(docs.slice(i, i + 450));
    return result;
  };
  const commitBatch = async (docs, fn) => {
    for (const chunk of chunks(docs)) {
      const b = db.batch();
      chunk.forEach(d => fn(b, d));
      await b.commit();
    }
  };

  try {
    const [apptSnap, savedSnap, featSnap, slotSnap] = await Promise.all([
      db.collection('appointments').where('roomId', '==', roomId).get(),
      db.collection('savedPosts').where('roomId', '==', roomId).get(),
      db.collection('featured_upgrade_requests').where('roomId', '==', roomId).get(),
      db.collection('bookedSlots').where('roomId', '==', roomId).get(),
    ]);

    const activeStatuses = new Set(['pending', 'confirmed', 'tenant_confirmed']);
    const notifPromises = [];
    const apptDocsToCancel = apptSnap.docs.filter(d => activeStatuses.has(d.data().status));

    for (const d of apptDocsToCancel) {
      const tenantId = d.data().tenantId;
      if (tenantId) {
        notifPromises.push(db.collection('notifications').add({
          userId: tenantId,
          title: 'Bài đăng đã bị xóa',
          message: `Phòng "${roomTitle}" bạn đã đặt lịch hẹn đã bị xóa. Lịch hẹn của bạn đã bị hủy.`,
          type: 'room_deleted',
          seen: false,
          isRead: false,
          createdAt: Date.now(),
        }));
      }
    }

    const cancelStatuses = new Set(['waiting_for_payment', 'paid_waiting_admin']);

    await Promise.all([
      commitBatch(apptDocsToCancel, (b, d) => b.update(d.ref, { status: 'cancelled_by_system', hasUnreadUpdate: true })),
      commitBatch(savedSnap.docs, (b, d) => b.delete(d.ref)),
      commitBatch(featSnap.docs.filter(d => cancelStatuses.has(d.data().status)), (b, d) =>
        b.update(d.ref, { status: 'cancelled', approvalStatus: 'cancelled', updatedAt: Date.now() })),
      commitBatch(slotSnap.docs, (b, d) => b.delete(d.ref)),
      ...notifPromises,
    ]);

    console.log(`[onRoomDeleted] cleaned up roomId=${roomId}, appointments=${apptDocsToCancel.length}, saved=${savedSnap.size}, slots=${slotSnap.size}`);
  } catch (e) {
    console.error(`[onRoomDeleted] error for roomId=${roomId}:`, e);
  }
});

exports.serverReservePostSlot = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn chưa đăng nhập.');

  const FREE_POSTS_PER_DAY = 3;
  const now = Date.now();

  // Build server-time GMT+7 date string ("YYYY-MM-DD")
  const gmt7Date = new Date(now + 7 * 60 * 60 * 1000);
  const yyyy = gmt7Date.getUTCFullYear();
  const mm = String(gmt7Date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(gmt7Date.getUTCDate()).padStart(2, '0');
  const todayGmt7 = `${yyyy}-${mm}-${dd}`;

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  try {
    return await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new HttpsError('not-found', 'Không tìm thấy tài khoản người dùng.');

      const storedDate = userSnap.get('dailyPostCountDate') || '';
      const storedCount = storedDate === todayGmt7 ? (userSnap.get('dailyPostCount') || 0) : 0;
      const purchased = userSnap.get('purchasedSlots') || 0;

      // Priority 1: free daily slots
      if (storedCount < FREE_POSTS_PER_DAY) {
        tx.update(userRef, { dailyPostCountDate: todayGmt7, dailyPostCount: storedCount + 1 });
        return { allowed: true, usePurchasedSlot: false };
      }

      // Priority 2: purchased extra slots
      if (purchased > 0) {
        tx.update(userRef, { purchasedSlots: purchased - 1, lastSlotConsumedAt: now });
        return { allowed: true, usePurchasedSlot: true };
      }

      // Blocked — compute unlock time at midnight GMT+7 tomorrow
      const tomorrowGmt7 = new Date(gmt7Date);
      tomorrowGmt7.setUTCDate(tomorrowGmt7.getUTCDate() + 1);
      tomorrowGmt7.setUTCHours(0, 0, 0, 0);
      const unlockAt = tomorrowGmt7.getTime() - 7 * 60 * 60 * 1000;
      return { allowed: false, unlockAt };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', e.message || 'Lỗi kiểm tra quota đăng bài.');
  }
});

// ─── Helper shared by booking CFs ───────────────────────────────────────────
function buildSlotId(roomId, date, time) {
  return `${roomId}_${date}_${time}`
    .replace(/\//g, '-').replace(/:/g, '-').replace(/ /g, '_');
}

// ─── serverSubmitBooking: enforce max-2-active appointments server-side ──────
exports.serverSubmitBooking = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn chưa đăng nhập.');

  const { roomId, appointmentDate, appointmentTime } = request.data || {};
  if (!roomId || !appointmentDate || !appointmentTime) {
    throw new HttpsError('invalid-argument', 'Thiếu thông tin lịch hẹn (roomId, date, time).');
  }

  const db = admin.firestore();

  // Check 1a (server-side): Giới hạn slot đã lock (confirmed/tenant_confirmed, max 2)
  const confirmedSnap = await db.collection('appointments')
    .where('tenantId', '==', uid)
    .where('status', 'in', ['confirmed', 'tenant_confirmed'])
    .get();
  if (confirmedSnap.size >= 2) {
    throw new HttpsError('resource-exhausted',
      `Bạn đang có ${confirmedSnap.size} lịch hẹn đã xác nhận. Vui lòng hoàn tất các lịch hẹn trước khi đặt thêm.`);
  }

  // Check 1b (server-side): Giới hạn lịch hẹn pending (chưa lock slot, max 3)
  const pendingCheckSnap = await db.collection('appointments')
    .where('tenantId', '==', uid)
    .where('status', '==', 'pending')
    .get();
  if (pendingCheckSnap.size >= 3) {
    throw new HttpsError('resource-exhausted',
      `Bạn đang có ${pendingCheckSnap.size} lịch hẹn chờ xác nhận. Vui lòng chờ phản hồi hoặc hủy bớt trước khi đặt thêm.`);
  }

  // Check 2 (server-side): maxDailyAppointments của phòng
  const roomDoc = await db.collection('rooms').doc(roomId).get();
  if (!roomDoc.exists) throw new HttpsError('not-found', 'Không tìm thấy phòng.');
  const maxDaily = (roomDoc.data().maxDailyAppointments) || 10;

  const daySlotSnap = await db.collection('bookedSlots')
    .where('roomId', '==', roomId)
    .where('date', '==', appointmentDate)
    .get();

  if (daySlotSnap.size >= maxDaily) {
    throw new HttpsError('resource-exhausted',
      `Ngày ${appointmentDate} đã đạt giới hạn tối đa ${maxDaily} lịch hẹn. Vui lòng chọn ngày khác.`);
  }

  // Check 3 + Tạo appointment trong transaction (tránh race condition đặt trùng slot)
  const slotId = buildSlotId(roomId, appointmentDate, appointmentTime);
  const slotRef = db.collection('bookedSlots').doc(slotId);
  const apptRef = db.collection('appointments').doc();
  const now = Date.now();

  const appointmentData = {
    ...request.data,
    id: apptRef.id,
    tenantId: uid,           // server override: không cho client giả mạo
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    landlordConfirmDeadline: now + 48 * 60 * 60 * 1000,
    tenantConfirmDeadline: 0,  // Sẽ được set khi chủ trọ xác nhận
    statusHistory: [],
    editCount: 0,
    landlordRemind12hSent: false, landlordRemind36hSent: false, landlordRemind47hSent: false,
    reminder24hSent: false, reminder2hSent: false, reminder30mSent: false, reminder0hSent: false,
    landlordReminder24hSent: false, landlordReminder2hSent: false,
    landlordReminder30mSent: false, landlordReminder0hSent: false,
    resultAskedSent: false, autoNoShowSent: false,
    hasUnreadUpdate: false, lastNotifiedAt: 0
  };

  try {
    await db.runTransaction(async (tx) => {
      const slotSnap = await tx.get(slotRef);
      if (slotSnap.exists) {
        throw new HttpsError('already-exists',
          `Khung giờ ${appointmentTime} ngày ${appointmentDate} đã có người đặt. Vui lòng chọn giờ khác.`);
      }
      tx.set(apptRef, appointmentData);
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', e.message || 'Lỗi đặt lịch.');
  }

  return { appointmentId: apptRef.id };
});

const expiry = require('./functions/expiry');
exports.notifyExpiringRooms = expiry.notifyExpiringRooms;
exports.deleteExpiredRooms = expiry.deleteExpiredRooms;

const notifications = require('./functions/notifications');
exports.sendPushNotification = notifications.sendPushNotification;
exports.sendBroadcastNotification = notifications.sendBroadcastNotification;
exports.notifyAdminOnNewSupportTicket = notifications.notifyAdminOnNewSupportTicket;
exports.notifyAdminOnSupportMessage = notifications.notifyAdminOnSupportMessage;

const payments = require('./functions/payments');
exports.processPendingSlotUpgradePayments = payments.processPendingSlotUpgradePayments;
exports.processPendingFeaturedUpgradePayments = payments.processPendingFeaturedUpgradePayments;
exports.sepayWebhook = payments.sepayWebhook;
exports.autoDisableExpiredFeaturedRooms = payments.autoDisableExpiredFeaturedRooms;

// ─── Appointment Scheduling Functions ────────────────────────────────────────

const db = admin.firestore();

async function sendAppNotification(userId, title, message, type) {
  if (!userId) return;
  await db.collection('notifications').add({
    userId, title, message, type,
    seen: false, isRead: false, createdAt: Date.now(),
  });
}

/**
 * Tự động hủy lịch pending sau 48h chủ trọ không xác nhận.
 * Chạy mỗi 1 giờ.
 */
exports.autoRejectExpiredPending = onSchedule(
  { schedule: 'every 1 hours', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    const snap = await db.collection('appointments')
      .where('status', '==', 'pending')
      .where('landlordConfirmDeadline', '<', now)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'pending') return;
        t.update(doc.ref, {
          status: 'expired_pending',
          updatedAt: now,
          hasUnreadUpdate: true,
          statusHistory: admin.firestore.FieldValue.arrayUnion({
            fromStatus: 'pending', toStatus: 'expired_pending',
            changedBy: 'system', changedById: 'system',
            reason: 'Chủ trọ không xác nhận trong 48h', timestamp: now,
          }),
        });
        updated = true;
      });
      if (!updated) continue;
      await sendAppNotification(data.tenantId, 'Lịch hẹn hết hạn',
        `Chủ trọ không xác nhận trong 48h. Lịch hẹn ngày ${data.appointmentDate} đã tự động hủy. Bạn có thể đặt lại hoặc tìm phòng khác.`,
        'appointment_expired');
      await sendAppNotification(data.landlordId, 'Lịch hẹn đã tự hủy',
        `Lịch hẹn với ${data.tenantName} ngày ${data.appointmentDate} đã tự hủy vì bạn không xác nhận trong 48h. Hãy phản hồi nhanh hơn để không bỏ lỡ khách.`,
        'appointment_expired_landlord');
    }
    console.log(`[autoRejectExpiredPending] Đã xử lý ${snap.size} lịch hết hạn.`);
  }
);

/**
 * Tự động hủy lịch confirmed nếu tenant không xác nhận sẽ đến trước deadline.
 * Chạy mỗi 30 phút.
 */
exports.autoExpireTenantUnconfirmed = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    const snap = await db.collection('appointments')
      .where('status', '==', 'confirmed')
      .where('tenantConfirmDeadline', '>', 0)
      .where('tenantConfirmDeadline', '<', now)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'confirmed') return;
        t.update(doc.ref, {
          status: 'cancelled_by_system',
          updatedAt: now,
          hasUnreadUpdate: true,
          statusHistory: admin.firestore.FieldValue.arrayUnion({
            fromStatus: 'confirmed', toStatus: 'cancelled_by_system',
            changedBy: 'system', changedById: 'system',
            reason: 'Người thuê không xác nhận sẽ đến trước deadline', timestamp: now,
          }),
        });
        const slotId = buildSlotId(data.roomId, data.appointmentDate, data.appointmentTime);
        t.delete(db.collection('bookedSlots').doc(slotId));
        updated = true;
      });
      if (!updated) continue;
      await sendAppNotification(data.tenantId, 'Lịch hẹn đã bị hủy tự động',
        `Bạn không xác nhận tham dự lịch xem phòng ngày ${data.appointmentDate} trước thời hạn. Lịch hẹn đã bị hủy tự động.`,
        'appointment_expired');
      await sendAppNotification(data.landlordId, 'Khách không xác nhận tham dự',
        `Khách ${data.tenantName || ''} không xác nhận tham dự lịch ngày ${data.appointmentDate} trước thời hạn. Lịch đã bị hủy và slot đã được giải phóng.`,
        'appointment_tenant_no_confirm');
    }
    console.log(`[autoExpireTenantUnconfirmed] Đã xử lý ${snap.size} lịch hẹn.`);
  }
);

/**
 * Nhắc chủ trọ xác nhận lịch pending theo chuỗi leo thang: +12h, +36h, +47h.
 * Chạy mỗi 1 giờ.
 */
exports.remindLandlordPending = onSchedule(
  { schedule: 'every 1 hours', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    const h12 = 12 * 3600 * 1000;
    const h36 = 36 * 3600 * 1000;
    const h47 = 47 * 3600 * 1000;

    const snap = await db.collection('appointments').where('status', '==', 'pending').get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const elapsed = now - (data.createdAt || 0);

      // +12h: nhắc lần đầu
      if (elapsed >= h12 && !data.landlordRemind12hSent) {
        let updated = false;
        await db.runTransaction(async (t) => {
          const freshDoc = await t.get(doc.ref);
          if (!freshDoc.exists) return;
          const fresh = freshDoc.data();
          if (fresh.status !== 'pending' || fresh.landlordRemind12hSent) return;
          t.update(doc.ref, { landlordRemind12hSent: true });
          updated = true;
        });
        if (updated) {
          await sendAppNotification(data.landlordId, 'Còn 36h để xác nhận lịch hẹn',
            `${data.tenantName} muốn xem phòng vào ${data.appointmentDateDisplay} lúc ${data.appointmentTime}. Bạn còn 36h để xác nhận hoặc từ chối.`,
            'landlord_remind_12h');
        }
      }

      // +36h: nhắc ưu tiên cao
      if (elapsed >= h36 && !data.landlordRemind36hSent) {
        let updated = false;
        await db.runTransaction(async (t) => {
          const freshDoc = await t.get(doc.ref);
          if (!freshDoc.exists) return;
          const fresh = freshDoc.data();
          if (fresh.status !== 'pending' || fresh.landlordRemind36hSent) return;
          t.update(doc.ref, { landlordRemind36hSent: true });
          updated = true;
        });
        if (updated) {
          await sendAppNotification(data.landlordId, '⚠️ Chỉ còn 12h! Sắp hết hạn',
            `Lịch hẹn với ${data.tenantName} ngày ${data.appointmentDate} sẽ tự hủy sau 12h nữa. Phản hồi ngay!`,
            'landlord_remind_36h');
        }
      }

      // +47h: nhắc khẩn cấp (1 tiếng trước khi tự hủy)
      if (elapsed >= h47 && !data.landlordRemind47hSent) {
        let updated = false;
        await db.runTransaction(async (t) => {
          const freshDoc = await t.get(doc.ref);
          if (!freshDoc.exists) return;
          const fresh = freshDoc.data();
          if (fresh.status !== 'pending' || fresh.landlordRemind47hSent) return;
          t.update(doc.ref, { landlordRemind47hSent: true });
          updated = true;
        });
        if (updated) {
          await sendAppNotification(data.landlordId, '🚨 Còn 1 giờ nữa là tự hủy!',
            `Lịch hẹn với ${data.tenantName} sẽ TỰ HỦY sau 1 tiếng. Đây là cơ hội cuối để xác nhận!`,
            'landlord_remind_47h');
        }
      }
    }
    console.log(`[remindLandlordPending] Đã kiểm tra ${snap.size} lịch pending.`);
  }
);

/**
 * Gửi thông báo nhắc lịch cho cả tenant và landlord: T-24h, T-2h, T-30 phút, T=0.
 * Chạy mỗi 15 phút.
 */
exports.sendAppointmentReminders = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    const in24h = now + 24 * 3600 * 1000;
    const in2h  = now + 2  * 3600 * 1000;
    const in30m = now + 30 * 60   * 1000;
    const activeStatuses = ['confirmed', 'tenant_confirmed'];

    // ── T-24h: nhắc tenant ──────────────────────────────────────────────────
    const snap24hTenant = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in24h)
      .where('reminder24hSent', '==', false)
      .get();
    for (const doc of snap24hTenant.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.reminder24hSent) return;
        t.update(doc.ref, { reminder24hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.tenantId, 'Nhắc lịch xem phòng ngày mai',
          `Ngày mai ${data.appointmentDateDisplay} lúc ${data.appointmentTime} bạn có hẹn xem phòng "${data.roomTitle}". Địa chỉ: ${data.roomAddress}.`,
          'appointment_reminder_24h');
      }
    }

    // ── T-24h: nhắc landlord ────────────────────────────────────────────────
    const snap24hLandlord = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in24h)
      .where('landlordReminder24hSent', '==', false)
      .get();
    for (const doc of snap24hLandlord.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.landlordReminder24hSent) return;
        t.update(doc.ref, { landlordReminder24hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.landlordId, 'Khách đến xem phòng ngày mai',
          `Ngày mai ${data.appointmentDateDisplay} lúc ${data.appointmentTime}, ${data.tenantName} (${data.tenantPhone}) sẽ đến xem phòng "${data.roomTitle}". Hãy chuẩn bị đón tiếp!`,
          'appointment_landlord_reminder_24h');
      }
    }

    // ── T-2h: nhắc tenant ───────────────────────────────────────────────────
    const snap2hTenant = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in2h)
      .where('reminder2hSent', '==', false)
      .get();
    for (const doc of snap2hTenant.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.reminder2hSent) return;
        t.update(doc.ref, { reminder2hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.tenantId, 'Còn 2 tiếng nữa đến giờ hẹn!',
          `Lịch xem phòng "${data.roomTitle}" lúc ${data.appointmentTime} hôm nay. Đừng quên nhé!`,
          'appointment_reminder_2h');
      }
    }

    // ── T-2h: nhắc landlord ─────────────────────────────────────────────────
    const snap2hLandlord = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in2h)
      .where('landlordReminder2hSent', '==', false)
      .get();
    for (const doc of snap2hLandlord.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.landlordReminder2hSent) return;
        t.update(doc.ref, { landlordReminder2hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.landlordId, 'Còn 2 tiếng nữa khách đến!',
          `${data.tenantName} sẽ đến xem phòng "${data.roomTitle}" lúc ${data.appointmentTime}. Hãy chuẩn bị sẵn sàng!`,
          'appointment_landlord_reminder_2h');
      }
    }

    // ── T-30m: nhắc tenant ──────────────────────────────────────────────────
    const snap30mTenant = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in30m)
      .where('reminder30mSent', '==', false)
      .get();
    for (const doc of snap30mTenant.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.reminder30mSent) return;
        t.update(doc.ref, { reminder30mSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.tenantId, 'Còn 30 phút nữa!',
          `Sắp đến giờ xem phòng "${data.roomTitle}" lúc ${data.appointmentTime}. Hãy di chuyển ngay!`,
          'appointment_reminder_30m');
      }
    }

    // ── T-30m: nhắc landlord ────────────────────────────────────────────────
    const snap30mLandlord = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '>', now)
      .where('appointmentTimestampMs', '<', in30m)
      .where('landlordReminder30mSent', '==', false)
      .get();
    for (const doc of snap30mLandlord.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.landlordReminder30mSent) return;
        t.update(doc.ref, { landlordReminder30mSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.landlordId, 'Khách sắp đến! Còn 30 phút',
          `${data.tenantName} (${data.tenantPhone}) sắp đến xem phòng "${data.roomTitle}" lúc ${data.appointmentTime}. Hãy có mặt tại phòng!`,
          'appointment_landlord_reminder_30m');
      }
    }

    // ── T=0: nhắc tenant (đúng giờ hẹn) ────────────────────────────────────
    const snap0hTenant = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '<=', now)
      .where('reminder0hSent', '==', false)
      .get();
    for (const doc of snap0hTenant.docs) {
      const data = doc.data();
      if (now - data.appointmentTimestampMs > 30 * 60 * 1000) continue;
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.reminder0hSent) return;
        t.update(doc.ref, { reminder0hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.tenantId, 'Đã đến giờ hẹn xem phòng!',
          `Bây giờ là ${data.appointmentTime}. Đến giờ xem phòng "${data.roomTitle}" rồi! Địa chỉ: ${data.roomAddress}.`,
          'appointment_reminder_0h');
      }
    }

    // ── T=0: nhắc landlord ──────────────────────────────────────────────────
    const snap0hLandlord = await db.collection('appointments')
      .where('status', 'in', activeStatuses)
      .where('appointmentTimestampMs', '<=', now)
      .where('landlordReminder0hSent', '==', false)
      .get();
    for (const doc of snap0hLandlord.docs) {
      const data = doc.data();
      if (now - data.appointmentTimestampMs > 30 * 60 * 1000) continue;
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!activeStatuses.includes(fresh.status) || fresh.landlordReminder0hSent) return;
        t.update(doc.ref, { landlordReminder0hSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.landlordId, `${data.tenantName} đã đến giờ hẹn`,
          `${data.tenantName} đang trên đường đến xem phòng "${data.roomTitle}" lúc ${data.appointmentTime}. Bạn đã sẵn sàng chưa?`,
          'appointment_landlord_reminder_0h');
      }
    }

    console.log(`[sendAppointmentReminders] tenant 24h:${snap24hTenant.size} 2h:${snap2hTenant.size} 30m:${snap30mTenant.size} 0h:${snap0hTenant.size} | landlord 24h:${snap24hLandlord.size} 2h:${snap2hLandlord.size} 30m:${snap30mLandlord.size} 0h:${snap0hLandlord.size}`);
  }
);

/**
 * Sau T+30 phút, hỏi chủ trọ kết quả: khách có đến không?
 * Chạy mỗi 15 phút.
 */
exports.autoClosePassedAppointments = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    const cutoff = now - 30 * 60 * 1000;

    const snap = await db.collection('appointments')
      .where('status', 'in', ['confirmed', 'tenant_confirmed'])
      .where('appointmentTimestampMs', '<', cutoff)
      .where('resultAskedSent', '==', false)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (!['confirmed', 'tenant_confirmed'].includes(fresh.status) || fresh.resultAskedSent) return;
        t.update(doc.ref, { resultAskedSent: true });
        updated = true;
      });
      if (updated) {
        await sendAppNotification(data.landlordId,
          'Lịch hẹn đã qua — Khách có đến không?',
          `Lịch xem phòng lúc ${data.appointmentTime} với ${data.tenantName} đã qua. Mở app và cập nhật kết quả nhé!`,
          'appointment_result_ask');
      }
    }
    console.log(`[autoClosePassedAppointments] Đã hỏi kết quả ${snap.size} lịch hẹn.`);
  }
);

/**
 * Tự động đánh no_show nếu chủ trọ không cập nhật kết quả sau 24h.
 * Chạy mỗi 1 giờ.
 */
exports.autoMarkNoShow = onSchedule(
  { schedule: 'every 1 hours', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const now = Date.now();
    // T+30m (resultAsked) + 24h = T+24.5h sau giờ hẹn
    const cutoff = now - 24.5 * 3600 * 1000;

    const snap = await db.collection('appointments')
      .where('status', 'in', ['confirmed', 'tenant_confirmed'])
      .where('resultAskedSent', '==', true)
      .where('autoNoShowSent', '==', false)
      .where('appointmentTimestampMs', '<', cutoff)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      let updated = false;
      await db.runTransaction(async (t) => {
        const freshDoc = await t.get(doc.ref);
        if (!freshDoc.exists) return;
        const fresh = freshDoc.data();
        if (fresh.autoNoShowSent || !['confirmed', 'tenant_confirmed'].includes(fresh.status)) return;
        t.update(doc.ref, {
          status: 'no_show',
          autoNoShowSent: true,
          hasUnreadUpdate: true,
          updatedAt: now,
          statusHistory: admin.firestore.FieldValue.arrayUnion({
            fromStatus: fresh.status, toStatus: 'no_show',
            changedBy: 'system', changedById: 'system',
            reason: 'Chủ trọ không cập nhật kết quả sau 24h', timestamp: now,
          }),
        });
        updated = true;
      });

      if (!updated) continue;

      // Xóa bookedSlot để mở lại slot
      const slotId = `${data.roomId}_${data.appointmentDate}_${data.appointmentTime}`
        .replace(/\//g, '-').replace(/:/g, '-').replace(/ /g, '_');
      await db.collection('bookedSlots').doc(slotId).delete().catch(() => {});

      // Cộng noShowCount trên tenant
      if (data.tenantId) {
        await db.collection('users').doc(data.tenantId)
          .update({ noShowCount: admin.firestore.FieldValue.increment(1) })
          .catch(() => {});
      }

      await sendAppNotification(data.tenantId, 'Lịch hẹn được ghi nhận là không đến',
        `Chủ trọ chưa cập nhật kết quả sau 24h. Hệ thống tự động ghi nhận bạn không đến lịch hẹn ngày ${data.appointmentDate}.`,
        'appointment_auto_no_show');
      await sendAppNotification(data.landlordId, 'Lịch hẹn đã tự động đóng',
        `Lịch hẹn với ${data.tenantName} ngày ${data.appointmentDate} đã được tự động đóng vì bạn không cập nhật kết quả. Slot đã được mở lại.`,
        'appointment_auto_no_show_landlord');
    }
    console.log(`[autoMarkNoShow] Đã tự động đánh no_show ${snap.size} lịch.`);
  }
);
