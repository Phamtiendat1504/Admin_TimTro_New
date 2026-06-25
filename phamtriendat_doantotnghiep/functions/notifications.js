const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

async function notifyAllAdmins(title, message, extraData) {
  const adminsSnap = await admin.firestore()
    .collection('users')
    .where('role', '==', 'admin')
    .get();
  if (adminsSnap.empty) return;
  const now = Date.now();
  const batch = admin.firestore().batch();
  adminsSnap.docs.forEach(adminDoc => {
    const ref = admin.firestore().collection('notifications').doc();
    batch.set(ref, {
      userId: adminDoc.id,
      title,
      message,
      seen: false,
      isRead: false,
      createdAt: now,
      ...extraData,
    });
  });
  await batch.commit();
}

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
        ticketId: data.ticketId || "",
        ticketTitle: data.ticketTitle || "",
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`Gửi thông báo thành công tới ${userId}: ${response}`);
  } catch (error) {
    console.error(`Lỗi gửi thông báo tới ${userId}:`, error);
  }
});

// Thông báo cho admin khi user tạo ticket hỗ trợ mới
exports.notifyAdminOnNewSupportTicket = onDocumentCreated(
  "support_tickets/{ticketId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    try {
      await notifyAllAdmins(
        'Yêu cầu hỗ trợ mới',
        `${data.userName || 'Người dùng'}: ${data.title || 'Yêu cầu hỗ trợ'}`,
        {
          type: 'new_support_ticket',
          ticketId: event.params.ticketId,
          ticketTitle: data.title || '',
        }
      );
    } catch (err) {
      console.error('[Support] notifyAdminOnNewSupportTicket lỗi:', err);
    }
  }
);

// Thông báo cho admin khi user gửi tin nhắn trong ticket đang xử lý
exports.notifyAdminOnSupportMessage = onDocumentCreated(
  "support_tickets/{ticketId}/messages/{msgId}",
  async (event) => {
    const msgData = event.data?.data();
    // Chỉ notify khi user gửi (không phải admin tự gửi)
    if (!msgData || msgData.senderRole !== 'user') return;
    const ticketId = event.params.ticketId;
    try {
      const ticketDoc = await admin.firestore()
        .collection('support_tickets').doc(ticketId).get();
      if (!ticketDoc.exists) return;
      const ticketData = ticketDoc.data();
      // Bỏ qua tin nhắn đầu tiên lúc tạo ticket (đã có trigger riêng)
      if (ticketData.status === 'new') return;
      await notifyAllAdmins(
        'Tin nhắn hỗ trợ mới',
        `${ticketData.userName || 'Người dùng'}: ${msgData.text || '[Hình ảnh]'}`,
        {
          type: 'support_message',
          ticketId,
          ticketTitle: ticketData.title || '',
        }
      );
    } catch (err) {
      console.error('[Support] notifyAdminOnSupportMessage lỗi:', err);
    }
  }
);

// FIX: Thêm hàm xử lý Broadcast gửi thông báo cho toàn bộ người dùng
exports.sendBroadcastNotification = onDocumentCreated(
  "system_notifications/{docId}", 
  async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const title = data.title || "Thông báo hệ thống";
  const body = data.content || "";

  const message = {
    topic: "all_users",
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
      type: "BROADCAST",
      createdAt: String(data.createdAt || Date.now()),
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Gửi thông báo Broadcast thành công:", response);
  } catch (error) {
    console.error("Lỗi gửi thông báo Broadcast:", error);
  }
});

