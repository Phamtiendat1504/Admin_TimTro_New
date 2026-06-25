/**
 * fix_utf8_index.js - Sửa lỗi encoding trong index.js
 * 
 * VẤN ĐỀ: File index.js có BOM UTF-8, nhưng nội dung tiếng Việt bị lỗi.
 * Nguyên nhân: các byte UTF-8 gốc của tiếng Việt đã bị decode sai qua 
 * encoding ISO-8859-2 (lead bytes) + Latin-1 (continuation bytes), 
 * rồi lưu lại dưới dạng UTF-8.
 *
 * GIẢI PHÁP: Đảo ngược quá trình bằng cách:
 * 1. Đọc file như UTF-8 (nhận được chuỗi mojibake)
 * 2. Map từng ký tự lạ về byte gốc theo bảng ISO-8859-2
 * 3. Decode kết quả như UTF-8 → ra tiếng Việt đúng
 *
 * Chạy: node fix_utf8_index.js
 */

const fs = require("fs");
const path = require("path");

const TARGET_FILE = path.join(
  __dirname,
  "phamtriendat_doantotnghiep",
  "index.js"
);
const BACKUP_FILE = TARGET_FILE + ".bak";

// === Bảng đảo ngược ===
// Mỗi entry: Unicode code point (trong file hiện tại) -> byte gốc
// Được xây dựng từ bảng ISO-8859-2 (cho bytes 0xA0-0xFF)
// Ref: https://en.wikipedia.org/wiki/ISO/IEC_8859-2

const REVERSE_MAP = {};

// Latin-1 supplement (0xA0-0xFF): hầu hết map 1-1 với Unicode
// Nhưng một số bytes trong ISO-8859-2 khác Latin-1:
const ISO_8859_2 = {
  0xA1: 0x0104, // Ą
  0xA2: 0x02D8, // ˘
  0xA3: 0x0141, // Ł
  0xA5: 0x013D, // Ľ
  0xA6: 0x015A, // Ś
  0xA9: 0x0160, // Š
  0xAA: 0x015E, // Ş
  0xAB: 0x0164, // Ť
  0xAC: 0x0179, // Ź
  0xAE: 0x017D, // Ž
  0xAF: 0x017B, // Ż
  0xB1: 0x0105, // ą
  0xB2: 0x02DB, // ˛
  0xB3: 0x0142, // ł
  0xB5: 0x013E, // ľ
  0xB6: 0x015B, // ś
  0xB7: 0x02C7, // ˇ
  0xB9: 0x0161, // š
  0xBA: 0x015F, // ş
  0xBB: 0x0165, // ť
  0xBC: 0x017A, // ź
  0xBD: 0x02DD, // ˝
  0xBE: 0x017E, // ž
  0xBF: 0x017C, // ż
  0xC0: 0x0154, // Ŕ
  0xC1: 0x00C1, // Á (same)
  0xC2: 0x00C2, // Â (same)
  0xC3: 0x0102, // Ă ← KEY! This is why Ă appears!
  0xC4: 0x00C4, // Ä (same)
  0xC5: 0x0139, // Ĺ
  0xC6: 0x0106, // Ć
  0xC7: 0x00C7, // Ç (same)
  0xC8: 0x010C, // Č
  0xC9: 0x00C9, // É (same)
  0xCA: 0x0118, // Ę
  0xCB: 0x00CB, // Ë (same)
  0xCC: 0x011A, // Ě
  0xCD: 0x00CD, // Í (same)
  0xCE: 0x00CE, // Î (same)
  0xCF: 0x010E, // Ď
  0xD0: 0x0110, // Đ
  0xD1: 0x0143, // Ń
  0xD2: 0x0147, // Ň
  0xD3: 0x00D3, // Ó (same)
  0xD4: 0x00D4, // Ô (same)
  0xD5: 0x0150, // Ő
  0xD6: 0x00D6, // Ö (same)
  0xD8: 0x0158, // Ř
  0xD9: 0x016E, // Ů
  0xDA: 0x00DA, // Ú (same)
  0xDB: 0x0170, // Ű
  0xDC: 0x00DC, // Ü (same)
  0xDD: 0x00DD, // Ý (same)
  0xDE: 0x0162, // Ţ
  0xDF: 0x00DF, // ß (same)
  0xE0: 0x0155, // ŕ
  0xE1: 0x00E1, // á (same)
  0xE2: 0x00E2, // â (same)
  0xE3: 0x0103, // ă
  0xE4: 0x00E4, // ä (same)
  0xE5: 0x013A, // ĺ
  0xE6: 0x0107, // ć
  0xE7: 0x00E7, // ç (same)
  0xE8: 0x010D, // č
  0xE9: 0x00E9, // é (same)
  0xEA: 0x0119, // ę
  0xEB: 0x00EB, // ë (same)
  0xEC: 0x011B, // ě
  0xED: 0x00ED, // í (same)
  0xEE: 0x00EE, // î (same)
  0xEF: 0x010F, // ď
  0xF0: 0x0111, // đ
  0xF1: 0x0144, // ń
  0xF2: 0x0148, // ň
  0xF3: 0x00F3, // ó (same)
  0xF4: 0x00F4, // ô (same)
  0xF5: 0x0151, // ő
  0xF6: 0x00F6, // ö (same)
  0xF8: 0x0159, // ř
  0xF9: 0x016F, // ů
  0xFA: 0x00FA, // ú (same)
  0xFB: 0x0171, // ű
  0xFC: 0x00FC, // ü (same)
  0xFD: 0x00FD, // ý (same)
  0xFE: 0x0163, // ţ
  0xFF: 0x02D9, // ˙
};

// Xây dựng reverse map: Unicode code point -> byte gốc
for (const [byteVal, codePoint] of Object.entries(ISO_8859_2)) {
  REVERSE_MAP[codePoint] = parseInt(byteVal);
}

// Với các bytes 0x80-0xFF không có trong bảng ISO-8859-2 riêng,
// map Unicode code point 1:1 với byte value (Latin-1 behaviour)
for (let b = 0x80; b <= 0xFF; b++) {
  const cp = ISO_8859_2[b] ?? b; // nếu không có mapping đặc biệt, dùng Latin-1
  if (!REVERSE_MAP[cp]) {
    REVERSE_MAP[cp] = b;
  }
}

// Windows-1252 special chars (0x80-0x9F range, undefined trong Latin-1)
const WIN1252_REVERSE = {
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201C: 0x93, // "
  0x201D: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F, // Ÿ
};

// Merge Windows-1252 vào reverse map (ưu tiên hơn ISO-8859-2)
for (const [cp, b] of Object.entries(WIN1252_REVERSE)) {
  REVERSE_MAP[parseInt(cp)] = b;
}

// === Đọc file ===
const rawBuffer = fs.readFileSync(TARGET_FILE);

// Backup
if (!fs.existsSync(BACKUP_FILE)) {
  fs.writeFileSync(BACKUP_FILE, rawBuffer);
  console.log("✅ Backup tạo tại:", BACKUP_FILE);
} else {
  console.log("ℹ️  Backup đã có:", BACKUP_FILE);
}

// Xử lý BOM
const hasBOM = rawBuffer[0] === 0xEF && rawBuffer[1] === 0xBB && rawBuffer[2] === 0xBF;
const content = (hasBOM ? rawBuffer.slice(3) : rawBuffer).toString("utf8");

// === Đảo ngược encoding ===
const fixedBytes = [];
let fixedCount = 0;
let unknownCount = 0;

for (let i = 0; i < content.length; i++) {
  const code = content.charCodeAt(i);

  if (code <= 0x7F) {
    // ASCII: giữ nguyên
    fixedBytes.push(code);
  } else if (REVERSE_MAP[code] !== undefined) {
    // Ký tự có trong bảng mapping: lấy byte gốc
    fixedBytes.push(REVERSE_MAP[code]);
    fixedCount++;
  } else if (code <= 0xFF) {
    // Latin-1 range không có mapping riêng: giữ nguyên byte
    fixedBytes.push(code);
    fixedCount++;
  } else {
    // Code point ngoài byte range, không xác định: encode lại UTF-8
    const encoded = Buffer.from(content[i], "utf8");
    for (const b of encoded) fixedBytes.push(b);
    unknownCount++;
    console.warn(`⚠️  Char U+${code.toString(16).toUpperCase().padStart(4,'0')} (${content[i]}) không có mapping, bỏ qua`);
  }
}

const fixedBuffer = Buffer.from(fixedBytes);

// === Verify ===
let fixedStr;
try {
  fixedStr = fixedBuffer.toString("utf8");
} catch (e) {
  console.error("❌ Kết quả không phải UTF-8 hợp lệ:", e.message);
  process.exit(1);
}

// Kiểm tra tiếng Việt OK
const lines = fixedStr.split("\n");
console.log("\n📄 Preview (dòng có tiếng Việt):");
[17, 24, 46, 247, 531, 682].forEach(lineIdx => {
  if (lines[lineIdx]) {
    console.log(`L${lineIdx + 1}: ${lines[lineIdx].trim()}`);
  }
});

console.log(`\n📊 Thống kê:`);
console.log(`   Ký tự đã map: ${fixedCount}`);
console.log(`   Ký tự không xác định: ${unknownCount}`);
console.log(`   Kích thước gốc: ${rawBuffer.length} bytes`);
console.log(`   Kích thước sau sửa: ${fixedBuffer.length + (hasBOM ? 3 : 0)} bytes`);

// === Ghi file ===
const outputBuffer = hasBOM
  ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), fixedBuffer])
  : fixedBuffer;

fs.writeFileSync(TARGET_FILE, outputBuffer);
console.log("\n✅ Đã ghi file:", TARGET_FILE);
console.log("💡 Nếu kết quả không đúng, khôi phục bằng lệnh:");
console.log("   copy phamtriendat_doantotnghiep\\index.js.bak phamtriendat_doantotnghiep\\index.js");
