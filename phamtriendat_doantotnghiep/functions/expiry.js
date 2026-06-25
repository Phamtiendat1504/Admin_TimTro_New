const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 450;
const MAX_ROOMS_PER_RUN = 300;

async function batchDeleteRefs(refs) {
  if (!refs || refs.length === 0) return 0;
  const db = admin.firestore();
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach(ref => batch.delete(ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Chạy mỗi ngày lúc 08:00 (GMT+7).
 * Tìm các bài đăng còn hạn nhưng sẽ hết hạn trong vòng 24 giờ tới,
 * gửi thông báo cho chủ trọ và đánh dấu đã thông báo để tránh spam.
 */
exports.notifyExpiringRooms = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const windowEnd = now + DAY_MS + 60 * 60 * 1000; // now + 25h (buffer 1h)

    try {
      // Query phòng: hết hạn trong (now, now+25h]
      const snap = await db.collection('rooms')
        .where('postExpiryDate', '>', now)
        .where('postExpiryDate', '<=', windowEnd)
        .limit(MAX_ROOMS_PER_RUN)
        .get();

      if (snap.empty) {
        console.log('[notifyExpiringRooms] Không có bài nào sắp hết hạn.');
        return null;
      }

      const batch = db.batch();
      let notifCount = 0;

      for (const doc of snap.docs) {
        const data = doc.data();
        const userId = data.userId;
        const title = data.title || 'Bài đăng của bạn';
        const expiryWarningNotifiedAt = data.expiryWarningNotifiedAt || 0;

        if (!userId) continue;

        // Bỏ qua nếu đã gửi thông báo trong 23h qua (tránh gửi lại do function retry)
        if (now - expiryWarningNotifiedAt < 23 * 60 * 60 * 1000) continue;

        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId,
          title: '⏰ Bài đăng sắp hết hạn',
          message: `Bài đăng "${title}" của bạn sẽ hết hạn hiển thị trong vòng 24 giờ tới và sẽ bị xóa khỏi hệ thống. Hãy đăng lại bài mới nếu bạn muốn tiếp tục cho thuê.`,
          type: 'post_expiry_warning',
          seen: false,
          isRead: false,
          createdAt: now,
          roomId: doc.id,
        });

        // Đánh dấu đã gửi thông báo trên document phòng
        batch.update(doc.ref, { expiryWarningNotifiedAt: now });
        notifCount++;
      }

      if (notifCount > 0) await batch.commit();
      console.log(`[notifyExpiringRooms] Đã gửi ${notifCount} thông báo sắp hết hạn.`);
    } catch (error) {
      console.error('[notifyExpiringRooms] Lỗi:', error);
    }

    return null;
  }
);

/**
 * Chạy mỗi ngày lúc 03:30 (GMT+7).
 * Tìm tất cả bài đăng đã quá ngày hết hạn (postExpiryDate > 0 và <= now),
 * xóa vĩnh viễn khỏi Firestore + Storage, gửi thông báo cho chủ trọ.
 */
exports.deleteExpiredRooms = onSchedule(
  { schedule: 'every day 03:30', timeZone: 'Asia/Ho_Chi_Minh' },
  async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const now = Date.now();

    try {
      // Query phòng có postExpiryDate đã qua, loại trừ bài không có ngày hết hạn (= 0)
      const snap = await db.collection('rooms')
        .where('postExpiryDate', '>', 0)
        .where('postExpiryDate', '<=', now)
        .limit(MAX_ROOMS_PER_RUN)
        .get();

      if (snap.empty) {
        console.log('[deleteExpiredRooms] Không có bài hết hạn cần xóa.');
        return null;
      }

      let totalDeleted = 0;

      for (const roomDoc of snap.docs) {
        const roomId = roomDoc.id;
        const data = roomDoc.data();
        const userId = data.userId;
        const title = data.title || 'Bài đăng';

        const refsToDelete = [roomDoc.ref];

        // Thu thập savedPosts liên quan
        const savedSnap = await db.collection('savedPosts')
          .where('roomId', '==', roomId)
          .get();
        savedSnap.forEach(d => refsToDelete.push(d.ref));

        // Thu thập appointments liên quan
        const apptSnap = await db.collection('appointments')
          .where('roomId', '==', roomId)
          .get();
        const apptIds = [];
        const activeStatuses = ['pending', 'confirmed', 'tenant_confirmed'];
        apptSnap.forEach(d => {
          refsToDelete.push(d.ref);
          apptIds.push(d.id);
        });

        // Lấy bookedSlots theo appointmentId (ĐÚNG — không dùng apptId làm document ID)
        // Xử lý theo batch vì Firestore 'in' giới hạn 10 phần tử
        const CHUNK_SIZE = 10;
        for (let i = 0; i < apptIds.length; i += CHUNK_SIZE) {
          const chunk = apptIds.slice(i, i + CHUNK_SIZE);
          const slotsSnap = await db.collection('bookedSlots')
            .where('appointmentId', 'in', chunk)
            .get();
          slotsSnap.forEach(d => refsToDelete.push(d.ref));
        }

        // Gửi thông báo cho tenant của các lịch active
        for (const apptDoc of apptSnap.docs) {
          const apptData = apptDoc.data();
          if (activeStatuses.includes(apptData.status) && apptData.tenantId) {
            try {
              await db.collection('notifications').add({
                userId: apptData.tenantId,
                title: 'Lịch hẹn bị hủy do bài hết hạn',
                message: `Bài đăng phòng "${title}" đã hết hạn. Lịch hẹn của bạn đã bị hủy tự động.`,
                type: 'post_expired_cancel',
                seen: false, isRead: false, createdAt: now,
              });
            } catch (e) {
              console.warn(`[deleteExpiredRooms] Không gửi được thông báo tenant ${apptData.tenantId}:`, e.message);
            }
          }
        }

        // Xóa tất cả documents liên quan theo batch
        await batchDeleteRefs(refsToDelete);

        // Xóa ảnh trên Cloud Storage
        try {
          await bucket.deleteFiles({ prefix: `rooms/${roomId}/` });
        } catch (e) {
          console.warn(`[deleteExpiredRooms] Không xóa được Storage rooms/${roomId}:`, e.message);
        }

        // Gửi thông báo cho chủ trọ sau khi xóa
        if (userId) {
          try {
            await db.collection('notifications').add({
              userId,
              title: '🗑️ Bài đăng đã bị xóa do hết hạn',
              message: `Bài đăng "${title}" của bạn đã hết thời hạn hiển thị và đã bị xóa khỏi hệ thống. Bạn có thể đăng lại bài mới nếu muốn tiếp tục cho thuê.`,
              type: 'post_expired_deleted',
              seen: false,
              isRead: false,
              createdAt: now,
            });
          } catch (e) {
            console.warn(`[deleteExpiredRooms] Không gửi được thông báo cho user ${userId}:`, e.message);
          }
        }

        totalDeleted++;
        console.log(`[deleteExpiredRooms] Đã xóa bài "${roomId}" (${title}).`);
      }

      console.log(`[deleteExpiredRooms] Tổng bài đã xóa trong lần chạy này: ${totalDeleted}.`);
    } catch (error) {
      console.error('[deleteExpiredRooms] Lỗi nghiêm trọng:', error);
    }

    return null;
  }
);
