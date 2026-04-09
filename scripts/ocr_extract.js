#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

let createWorker;
try {
  // Prefer the named export if available
  const t = require("tesseract.js");
  createWorker =
    t.createWorker || (t.default && t.default.createWorker) || null;
} catch (e) {
  console.error(
    "tesseract.js is not installed. Install it with: npm install tesseract.js"
  );
  process.exit(2);
}

if (!createWorker) {
  console.error(
    "tesseract.js does not expose createWorker in this environment. Ensure tesseract.js v2+ is installed."
  );
  process.exit(2);
}

const DRUG_LICENSE_REGEX = /[A-Z0-9\/-]{6,25}/gi;
const DRUG_KEYWORDS = [
  /drug license/i,
  /license no/i,
  /licence no/i,
  /lic no/i,
  /drug licence/i,
  /license number/i,
  /lic no\.?/i,
];

async function run(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  console.log("Running OCR on", filePath);
  let raw = "";
  // Try worker API first
  try {
    const worker = createWorker();
    if (worker && typeof worker.load === "function") {
      await worker.load();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      const {
        data: { text },
      } = await worker.recognize(path.resolve(filePath));
      raw = String(text || "");
      await worker.terminate();
    } else {
      throw new Error("worker API not available");
    }
  } catch (e) {
    // Fallback to direct recognize API if available
    try {
      const t = require("tesseract.js");
      if (typeof t.recognize === "function") {
        const {
          data: { text },
        } = await t.recognize(path.resolve(filePath), "eng");
        raw = String(text || "");
      } else {
        throw e;
      }
    } catch (err) {
      throw err;
    }
  }

  // 'raw' already holds the OCR text from either worker or recognize fallback
  console.log("---- OCR TEXT START ----");
  console.log(raw);
  console.log("---- OCR TEXT END ----");

  const keywords = DRUG_KEYWORDS.filter((rx) => rx.test(raw)).map(
    (r) => r.source
  );

  const candidates = [];
  let m;
  while ((m = DRUG_LICENSE_REGEX.exec(raw)) !== null) {
    const token = m[0].trim();
    if (token.length >= 6 && token.length <= 25) candidates.push(token);
  }

  console.log("Keywords found:", keywords);
  console.log("License candidates:", candidates);
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/ocr_extract.js <path-to-image>");
    process.exit(1);
  }
  run(file).catch((err) => {
    console.error("OCR failed:", err && err.message);
    process.exit(3);
  });
}
