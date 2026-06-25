const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  sepayApiToken,
  SLOT_UPGRADE_EXPIRE_MS,
  SLOT_UPGRADE_SCAN_LIMIT,
  SLOT_PACKAGES,
  FEATURED_PACKAGES,
  extractRequestCode,
  fetchSePayTransactions,
} = require("./payments-helpers");

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

    const promises = waitingSnap.docs.map(async (doc) => {
      const data = doc.data() || {};
      const createdAt = Number(data.createdAt || 0);
      const expiresAt = Number(data.expiresAt || (createdAt > 0 ? createdAt + SLOT_UPGRADE_EXPIRE_MS : 0));
      const code = String(data.code || "").trim().toUpperCase();
      let expectedAmount = 0;
      let slots = 0;

      if (SLOT_PACKAGES[code]) {
        expectedAmount = SLOT_PACKAGES[code].price;
        slots = SLOT_PACKAGES[code].slots;
      } else if (code === "CUSTOM") {
        slots = Number(data.slots || 0);
        if (slots > 0) expectedAmount = slots * 5000;
      } else {
        console.warn(`[processPendingSlotUpgradePayments] Invalid slot package code: ${code} in doc: ${doc.id}`);
        await doc.ref.set({ status: "failed", failReason: "invalid_package_code", updatedAt: now }, { merge: true });
        return;
      }

      if (expectedAmount <= 0 || slots <= 0) return;

      if (expiresAt > 0 && now > expiresAt) {
        await doc.ref.set({ status: "expired", expiredAt: now, updatedAt: now }, { merge: true });
        return;
      }

      const expectedRequestCode = extractRequestCode(data.transferNote);
      if (!expectedRequestCode) return;

      const matchedTx = transactions.find((tx) => {
        const txRequestCode = extractRequestCode(tx.rawContent || "");
        if (expectedRequestCode && txRequestCode) return txRequestCode === expectedRequestCode;
        if (expectedRequestCode && tx.content.includes(`req${expectedRequestCode.toLowerCase()}`)) return true;
        return false;
      });
      if (!matchedTx) return;

      const uid = String(data.uid || "").trim();
      if (!uid) {
        await doc.ref.set({ status: "failed", failReason: "invalid_request_payload", updatedAt: now }, { merge: true });
        return;
      }

      const userRef = db.collection("users").doc(uid);
      const notifRef = db.collection("notifications").doc();
      const paymentRecordRef = db.collection("processed_payments").doc(matchedTx.txId);

      await db.runTransaction(async (tx) => {
        const [freshReqSnap, userSnap, paymentRecordSnap] = await Promise.all([
          tx.get(doc.ref),
          tx.get(userRef),
          tx.get(paymentRecordRef)
        ]);

        if (!freshReqSnap.exists) return;
        if (paymentRecordSnap.exists) {
          console.warn(`[processPendingSlotUpgradePayments] Transaction ${matchedTx.txId} already processed.`);
          return;
        }

        const freshReq = freshReqSnap.data() || {};
        if (String(freshReq.status || "") !== "waiting_for_payment") return;

        const freshCreatedAt = Number(freshReq.createdAt || 0);
        const freshExpiresAt = Number(freshReq.expiresAt || (freshCreatedAt > 0 ? freshCreatedAt + SLOT_UPGRADE_EXPIRE_MS : 0));
        if (freshExpiresAt > 0 && now > freshExpiresAt) {
          tx.set(doc.ref, { status: "expired", expiredAt: now, updatedAt: now }, { merge: true });
          return;
        }

        const currentSlots = Number(userSnap.data()?.purchasedSlots || 0);
        const receivedAmount = Math.round(Number(matchedTx.amountIn || 0));
        if (receivedAmount !== expectedAmount) {
          tx.set(doc.ref, { status: "amount_mismatch", receivedAmount, expectedAmount, matchedTxId: matchedTx.txId, updatedAt: now }, { merge: true });
          return;
        }

        tx.set(doc.ref, { status: "paid", paidAt: now, updatedAt: now, paymentProvider: "sepay", providerTxId: matchedTx.txId, paidAmount: receivedAmount, paidContent: matchedTx.rawContent }, { merge: true });
        tx.set(userRef, { purchasedSlots: currentSlots + slots }, { merge: true });
        tx.set(notifRef, { userId: uid, title: "Nạp lượt thành công", message: `Bạn đã được cộng thêm ${slots} lượt đăng bài.`, type: "slot_upgrade_paid", seen: false, isRead: false, createdAt: now });
        tx.set(paymentRecordRef, { txId: matchedTx.txId, uid, amount: receivedAmount, content: matchedTx.rawContent, type: "slot_upgrade", requestId: doc.id, processedAt: now });
      });
    });

    await Promise.all(promises);
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

    const promises = waitingSnap.docs.map(async (doc) => {
      const data = doc.data() || {};
      const createdAt = Number(data.createdAt || 0);
      const expiresAt = Number(data.expiresAt || (createdAt > 0 ? createdAt + SLOT_UPGRADE_EXPIRE_MS : 0));
      const code = String(data.code || "").trim().toUpperCase();
      let expectedAmount = 0;
      let days = 0;

      if (FEATURED_PACKAGES[code]) {
        expectedAmount = FEATURED_PACKAGES[code].price;
        days = FEATURED_PACKAGES[code].days;
      } else if (code === "FT_CUSTOM") {
        days = Number(data.days || 0);
        if (days > 0) expectedAmount = days * 10000;
      } else {
        console.warn(`[processPendingFeaturedUpgradePayments] Invalid featured package code: ${code} in doc: ${doc.id}`);
        await doc.ref.set({ status: "failed", failReason: "invalid_package_code", updatedAt: now }, { merge: true });
        return;
      }

      if (expectedAmount <= 0 || days <= 0) return;

      if (expiresAt > 0 && now > expiresAt) {
        await doc.ref.set({ status: "expired", approvalStatus: "expired", expiredAt: now, updatedAt: now }, { merge: true });
        return;
      }

      const expectedRequestCode = extractRequestCode(data.transferNote);
      if (!expectedRequestCode) return;

      const matchedTx = transactions.find((tx) => {
        const txRequestCode = extractRequestCode(tx.rawContent || "");
        if (expectedRequestCode && txRequestCode) return txRequestCode === expectedRequestCode;
        if (expectedRequestCode && tx.content.includes(`req${expectedRequestCode.toLowerCase()}`)) return true;
        return false;
      });
      if (!matchedTx) return;

      const uid = String(data.uid || "").trim();
      const roomId = String(data.roomId || "").trim();
      if (!uid || !roomId) {
        await doc.ref.set({ status: "failed", failReason: "invalid_request_payload", updatedAt: now }, { merge: true });
        return;
      }

      const roomRef = db.collection("rooms").doc(roomId);
      const notifRef = db.collection("notifications").doc();
      const paymentRecordRef = db.collection("processed_payments").doc(matchedTx.txId);

      await db.runTransaction(async (tx) => {
        const [freshReqSnap, paymentRecordSnap] = await Promise.all([
          tx.get(doc.ref),
          tx.get(paymentRecordRef)
        ]);

        if (!freshReqSnap.exists) return;
        if (paymentRecordSnap.exists) {
          console.warn(`[processPendingFeaturedUpgradePayments] Transaction ${matchedTx.txId} already processed.`);
          return;
        }

        const freshReq = freshReqSnap.data() || {};
        if (freshReq.status !== "waiting_for_payment") return;

        const freshCreatedAt = Number(freshReq.createdAt || 0);
        const freshExpiresAt = Number(freshReq.expiresAt || (freshCreatedAt > 0 ? freshCreatedAt + SLOT_UPGRADE_EXPIRE_MS : 0));
        if (freshExpiresAt > 0 && now > freshExpiresAt) {
          tx.set(doc.ref, { status: "expired", approvalStatus: "expired", expiredAt: now, updatedAt: now }, { merge: true });
          return;
        }

        const receivedAmount = Math.round(Number(matchedTx.amountIn || 0));
        if (receivedAmount !== expectedAmount) {
          tx.set(doc.ref, { status: "failed", failReason: "amount_mismatch", receivedAmount, expectedAmount, matchedTxId: matchedTx.txId, updatedAt: now }, { merge: true });
          return;
        }

        tx.set(doc.ref, { status: "paid_waiting_admin", approvalStatus: "pending_admin", paidAt: now, updatedAt: now, paymentProvider: "sepay", providerTxId: matchedTx.txId, paidAmount: receivedAmount, paidContent: matchedTx.rawContent }, { merge: true });
        tx.set(roomRef, { featuredRequestId: doc.id, featuredRequestStatus: "paid_waiting_admin" }, { merge: true });
        tx.set(notifRef, { userId: uid, title: "Đã thanh toán gói nổi bật", message: "Yêu cầu đẩy bài nổi bật đã được ghi nhận và đang chờ admin duyệt.", type: "featured_upgrade_paid", seen: false, isRead: false, createdAt: now });
        tx.set(paymentRecordRef, { txId: matchedTx.txId, uid, roomId, days, amount: matchedTx.amountIn, content: matchedTx.rawContent, type: "featured_upgrade", requestId: doc.id, processedAt: now });
      });
    });

    await Promise.all(promises);
    return null;
  }
);
