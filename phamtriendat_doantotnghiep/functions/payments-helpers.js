const { defineSecret } = require("firebase-functions/params");

const sepayApiToken = defineSecret("SEPAY_API_TOKEN");
const SEPAY_TRANSACTIONS_API = "https://my.sepay.vn/userapi/transactions/list";
const SLOT_UPGRADE_EXPIRE_MS = 30 * 60 * 1000;
const SLOT_UPGRADE_SCAN_LIMIT = 200;

const SLOT_PACKAGES = {
  "GOI01": { slots: 3, price: 10000 },
  "GOI02": { slots: 5, price: 20000 },
  "GOI03": { slots: 10, price: 40000 }
};

const FEATURED_PACKAGES = {
  "FT03": { days: 3, price: 10000 },
  "FT07": { days: 7, price: 20000 },
  "FT15": { days: 15, price: 40000 }
};

function normalizeSePayContent(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractRequestCode(raw) {
  const text = String(raw || "").toUpperCase();
  const m = text.match(/REQ[_\-\s]*([A-Z0-9]{8})/);
  return m ? m[1] : "";
}

function parseSePayAmount(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : 0;
  const text = String(raw || "").trim();
  if (!text) return 0;
  let cleaned = text.replace(/\.00$/, "");
  const digits = cleaned.replace(/[^\d]/g, "");
  if (digits) {
    const parsedInt = Number.parseInt(digits, 10);
    return Number.isFinite(parsedInt) ? parsedInt : 0;
  }
  return 0;
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
  const url = `${SEPAY_TRANSACTIONS_API}?limit=100`;
  const res = await fetch(url, {
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
      tx?.amount_in_text ??
      tx?.transferAmount
    ),
    content: normalizeSePayContent(pickSePayContent(tx)),
    rawContent: pickSePayContent(tx),
  }));
}

module.exports = {
  sepayApiToken,
  SLOT_UPGRADE_EXPIRE_MS,
  SLOT_UPGRADE_SCAN_LIMIT,
  SLOT_PACKAGES,
  FEATURED_PACKAGES,
  normalizeSePayContent,
  extractRequestCode,
  parseSePayAmount,
  extractSePayTxId,
  pickSePayContent,
  fetchSePayTransactions,
};
