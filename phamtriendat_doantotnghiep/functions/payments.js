const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  sepayApiToken,
  SLOT_PACKAGES,
  FEATURED_PACKAGES,
  SLOT_UPGRADE_EXPIRE_MS,
  extractRequestCode,
  parseSePayAmount,
  extractSePayTxId,
  pickSePayContent,
  normalizeSePayContent,
} = require("./payments-helpers");
const cron = require("./payments-cron");

// ── Re-exports cron jobs ─────────────────────────────────────────────────────
exports.processPendingSlotUpgradePayments = cron.processPendingSlotUpgradePayments;
exports.processPendingFeaturedUpgradePayments = cron.processPendingFeaturedUpgradePayments;

// ── Webhook SePay (đối soát realtime < 2 giây) ──────────────────────────────
exports.sepayWebhook = onRequest(
  { secrets: [sepayApiToken], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const token = String(sepayApiToken.value() || "").trim();
    const authHeader = req.headers["authorization"] || "";
    const expectedAuth = `Apikey ${token}`;
    if (!token || authHeader !== expectedAuth) {
      console.warn("[sepayWebhook] Unauthorized webhook request.");
      return res.status(401).send("Unauthorized");
    }

    const tx = req.body;
    if (!tx) {
      return res.status(400).send("Bad Request: Missing body");
    }

    console.log("[sepayWebhook] Received:", { id: tx.id || tx.transferId, amount: tx.amount_in || tx.amountIn || tx.amount });

    const db = admin.firestore();
    const now = Date.now();

    const txId = extractSePayTxId(tx);
    const amountIn = parseSePayAmount(
      tx.amount_in ?? tx.amountIn ?? tx.amount_in_value ?? tx.amountValue ??
      tx.in_amount ?? tx.credit ?? tx.amount ?? tx.transferAmount
    );
    const rawContent = pickSePayContent(tx);

    if (!txId || amountIn <= 0) {
      return res.status(400).send("Bad Request: Invalid amount or ID");
    }

    const expectedRequestCode = extractRequestCode(rawContent);
    if (!expectedRequestCode) {
      console.warn("[sepayWebhook] No request code in content.");
      return res.status(200).send("Ignored: No request code found");
    }

    const paymentRecordRef = db.collection("processed_payments").doc(txId);
    const paymentRecordSnap = await paymentRecordRef.get();
    if (paymentRecordSnap.exists) {
      console.log(`[sepayWebhook] Transaction ${txId} already processed.`);
      return res.status(200).send("OK: Already processed");
    }

    let foundReqSnap = null;
    let type = "";

    const slotReqQuery = await db.collection("slot_upgrade_requests")
      .where("status", "==", "waiting_for_payment")
      .get();
    let matchedDoc = slotReqQuery.docs.find((d) => {
      const reqCode = extractRequestCode(d.data().transferNote || "");
      return reqCode && reqCode === expectedRequestCode;
    });
    if (matchedDoc) { foundReqSnap = matchedDoc; type = "slot"; }

    if (!foundReqSnap) {
      const featReqQuery = await db.collection("featured_upgrade_requests")
        .where("status", "==", "waiting_for_payment")
        .get();
      matchedDoc = featReqQuery.docs.find((d) => {
        const reqCode = extractRequestCode(d.data().transferNote || "");
        return reqCode && reqCode === expectedRequestCode;
      });
      if (matchedDoc) { foundReqSnap = matchedDoc; type = "featured"; }
    }

    if (!foundReqSnap) {
      console.warn(`[sepayWebhook] No waiting request matches code: ${expectedRequestCode}`);
      return res.status(200).send("Ignored: No matching request");
    }

    const data = foundReqSnap.data() || {};
    const uid = String(data.uid || "").trim();
    if (!uid) return res.status(500).send("Error: Missing uid in request");

    try {
      if (type === "slot") {
        const code = String(data.code || "").trim().toUpperCase();
        let expectedAmount = 0;
        let slots = 0;

        if (SLOT_PACKAGES[code]) {
          expectedAmount = SLOT_PACKAGES[code].price;
          slots = SLOT_PACKAGES[code].slots;
        } else if (code === "CUSTOM") {
          slots = Number(data.slots || 0);
          if (slots > 0) expectedAmount = slots * 5000;
        }
        if (expectedAmount <= 0 || slots <= 0) return res.status(400).send("Error: Invalid package data");

        const userRef = db.collection("users").doc(uid);
        const notifRef = db.collection("notifications").doc();

        await db.runTransaction(async (txCtx) => {
          const [freshReqSnap, userSnap, paymentRecordSnapFresh] = await Promise.all([
            txCtx.get(foundReqSnap.ref),
            txCtx.get(userRef),
            txCtx.get(paymentRecordRef)
          ]);
          if (paymentRecordSnapFresh.exists) return;
          const freshReq = freshReqSnap.data() || {};
          if (freshReq.status !== "waiting_for_payment") return;
          if (amountIn !== expectedAmount) {
            txCtx.set(foundReqSnap.ref, { status: "amount_mismatch", receivedAmount: amountIn, expectedAmount, matchedTxId: txId, updatedAt: now }, { merge: true });
            return;
          }
          const currentSlots = Number(userSnap.data()?.purchasedSlots || 0);
          txCtx.set(foundReqSnap.ref, { status: "paid", paidAt: now, updatedAt: now, paymentProvider: "sepay", providerTxId: txId, paidAmount: amountIn, paidContent: rawContent }, { merge: true });
          txCtx.set(userRef, { purchasedSlots: currentSlots + slots }, { merge: true });
          txCtx.set(notifRef, { userId: uid, title: "Nạp lượt thành công", message: `Bạn đã được cộng thêm ${slots} lượt đăng bài.`, type: "slot_upgrade_paid", seen: false, isRead: false, createdAt: now });
          txCtx.set(paymentRecordRef, { txId, uid, amount: amountIn, content: rawContent, type: "slot_upgrade", requestId: foundReqSnap.id, processedAt: now });
        });
      } else if (type === "featured") {
        const code = String(data.code || "").trim().toUpperCase();
        let expectedAmount = 0;
        let days = 0;

        if (FEATURED_PACKAGES[code]) {
          expectedAmount = FEATURED_PACKAGES[code].price;
          days = FEATURED_PACKAGES[code].days;
        } else if (code === "FT_CUSTOM") {
          days = Number(data.days || 0);
          if (days > 0) expectedAmount = days * 10000;
        }
        if (expectedAmount <= 0 || days <= 0) return res.status(400).send("Error: Invalid package data");

        const roomId = String(data.roomId || "").trim();
        if (!roomId) return res.status(400).send("Error: Missing roomId");

        const roomRef = db.collection("rooms").doc(roomId);
        const notifRef = db.collection("notifications").doc();

        await db.runTransaction(async (txCtx) => {
          const [freshReqSnap, paymentRecordSnapFresh] = await Promise.all([
            txCtx.get(foundReqSnap.ref),
            txCtx.get(paymentRecordRef)
          ]);
          if (paymentRecordSnapFresh.exists) return;
          const freshReq = freshReqSnap.data() || {};
          if (freshReq.status !== "waiting_for_payment") return;
          if (amountIn !== expectedAmount) {
            txCtx.set(foundReqSnap.ref, { status: "amount_mismatch", receivedAmount: amountIn, expectedAmount, matchedTxId: txId, updatedAt: now }, { merge: true });
            return;
          }
          txCtx.set(foundReqSnap.ref, { status: "paid_waiting_admin", approvalStatus: "pending_admin", paidAt: now, updatedAt: now, paymentProvider: "sepay", providerTxId: txId, paidAmount: amountIn, paidContent: rawContent }, { merge: true });
          txCtx.set(roomRef, { featuredRequestId: foundReqSnap.id, featuredRequestStatus: "paid_waiting_admin" }, { merge: true });
          txCtx.set(notifRef, { userId: uid, title: "Đã thanh toán gói nổi bật", message: "Yêu cầu đẩy bài nổi bật đã được ghi nhận và đang chờ admin duyệt.", type: "featured_upgrade_paid", seen: false, isRead: false, createdAt: now });
          txCtx.set(paymentRecordRef, { txId, uid, roomId, days, amount: amountIn, content: rawContent, type: "featured_upgrade", requestId: foundReqSnap.id, processedAt: now });
        });
      }

      return res.status(200).send("OK: Webhook transaction processed");
    } catch (err) {
      console.error("[sepayWebhook] Exception in webhook processing:", err);
      return res.status(500).send("Internal Server Error");
    }
  }
);

// ── Tắt phòng nổi bật đã hết hạn ─────────────────────────────────────────────
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

    for (const doc of snap.docs) {
      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(doc.ref);
        if (!freshSnap.exists) return;
        const freshData = freshSnap.data() || {};
        const freshFeaturedUntil = Number(freshData.featuredUntil || 0);
        if (freshData.isFeatured === true && freshFeaturedUntil > 0 && freshFeaturedUntil <= now) {
          transaction.set(doc.ref, { isFeatured: false, featuredRequestStatus: "expired", featuredExpiredAt: now }, { merge: true });
          const uid = freshData.userId;
          if (uid) {
            const notifRef = db.collection("notifications").doc();
            transaction.set(notifRef, {
              userId: uid,
              title: "Hết hạn dịch vụ nổi bật",
              message: `Bài đăng "${freshData.title || "Phòng trọ"}" của bạn đã hết thời gian hiển thị nổi bật trên trang chủ. Bạn có thể tiếp tục đăng ký dịch vụ để đẩy bài đăng nổi bật trở lại.`,
              type: "featured_expired",
              seen: false,
              isRead: false,
              createdAt: now,
            });
          }
        }
      });
    }
    return null;
  }
);
