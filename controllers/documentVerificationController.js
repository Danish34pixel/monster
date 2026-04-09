const fs = require("fs");
const path = require("path");
const { uploadToCloudinary } = require("../config/cloudinary");

let Tesseract;
try {
  Tesseract = require("tesseract.js");
} catch (e) {
  Tesseract = null;
}

let Jimp, jsQR;
try {
  Jimp = require("jimp");
  jsQR = require("jsqr");
} catch (e) {
  Jimp = null;
  jsQR = null;
}

// Simple Aadhaar number regex: 12 digits (grouping/spacing allowed)
const AADHAAR_REGEX = /(?:\b|^)(?:\d[ -]*?){12}(?:\b|$)/g;

exports.verifyDocument = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use form field `document`.",
      });

    const file = req.file;
    // Optional: upload to cloudinary (non-blocking — but we'll do it for storage)
    let cloudUrl = null;
    try {
      const r = await uploadToCloudinary(file, "documents");
      cloudUrl = r.url;
    } catch (e) {
      // Log but continue — Cloudinary optional
      console.warn("Cloudinary upload failed (non-fatal):", e && e.message);
    }

    // If Tesseract not installed, return helpful message
    if (!Tesseract) {
      return res.status(501).json({
        success: false,
        message:
          "OCR provider `tesseract.js` is not installed on the server. Run `npm install tesseract.js` in Backend and restart.",
      });
    }

    // Run OCR
    const imgPath = path.resolve(file.path);
    const worker = Tesseract.createWorker({
      logger: (m) => {
        /* optionally forward progress */
      },
    });
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const {
      data: { text },
    } = await worker.recognize(imgPath);
    await worker.terminate();

    // Find Aadhaar-like numbers
    const matches = [];
    const raw = String(text || "");
    let m;
    while ((m = AADHAAR_REGEX.exec(raw)) !== null) {
      // normalize digits only
      const digits = m[0].replace(/\D/g, "");
      matches.push(digits);
    }

    // Basic quality checks: mime, size
    const quality = {
      sizeBytes: file.size,
      mime: file.mimetype,
      cloudUrl,
    };

    const result = {
      success: true,
      ocrText: raw,
      aadharCandidates: matches,
      quality,
      message: matches.length
        ? "Possible Aadhaar number(s) found"
        : "No Aadhaar-like number found in OCR",
    };

    // Debug: always log full OCR text and top Aadhaar candidate (if any)
    try {
      console.log("OCR text (upload, Aadhaar check):");
      console.log(raw);
      const topAadhaar = matches && matches.length ? matches[0] : null;
      if (topAadhaar)
        console.log(`Top Aadhaar candidate (upload): ${topAadhaar}`);
      else
        console.log(
          `No Aadhaar-like candidate detected for uploaded file: ${file.path}`
        );
    } catch (e) {
      // non-fatal logging error
      console.warn("Failed to log OCR debug info:", e && e.message);
    }

    return res.json(result);
  } catch (error) {
    console.error("Document verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Document verification failed",
      error: error && error.message,
    });
  }
};

// Basic drug license regex candidates (very permissive: letters, numbers, slashes, dashes)
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

exports.verifyDrugLicense = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use form field `document`.",
      });
    const file = req.file;

    let cloudUrl = null;
    try {
      const r = await uploadToCloudinary(file, "documents/drug-licenses");
      cloudUrl = r.url;
    } catch (e) {
      console.warn("Cloudinary upload failed (non-fatal):", e && e.message);
    }

    if (!Tesseract) {
      return res.status(501).json({
        success: false,
        message:
          "OCR provider `tesseract.js` is not installed on the server. Run `npm install tesseract.js` in Backend and restart.",
      });
    }

    const imgPath = path.resolve(file.path);

    // Try QR code decoding first (if libs available)
    let qrResult = null;
    if (Jimp && jsQR) {
      try {
        const image = await Jimp.read(imgPath);
        const { data, width, height } = image.bitmap; // RGBA buffer
        const code = jsQR(new Uint8ClampedArray(data), width, height);
        if (code) {
          qrResult = { raw: code.data };
          try {
            qrResult.json = JSON.parse(code.data);
          } catch (e) {
            // not JSON, ignore
          }
        }
      } catch (e) {
        console.warn("QR decode failed (non-fatal):", e && e.message);
      }
    }

    const worker = Tesseract.createWorker({ logger: (m) => {} });
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const {
      data: { text },
    } = await worker.recognize(imgPath);
    await worker.terminate();

    const raw = String(text || "");
    // Find keywords
    const keywords = DRUG_KEYWORDS.filter((rx) => rx.test(raw)).map(
      (r) => r.source
    );

    // Find license-like candidates by regex, then filter by length and presence near keywords
    const candidates = [];
    let m;
    while ((m = DRUG_LICENSE_REGEX.exec(raw)) !== null) {
      const token = m[0].trim();
      if (token.length >= 6 && token.length <= 25) candidates.push(token);
    }

    const quality = { sizeBytes: file.size, mime: file.mimetype, cloudUrl };

    // Debug: always log full OCR text and top license candidate (if any)
    try {
      console.log("OCR text (upload, drug-license):");
      console.log(raw);
      // Determine the best candidate to print in server logs: prefer QR payload, then first candidate
      let best = null;
      if (qrResult && qrResult.raw) best = qrResult.raw;
      else if (candidates && candidates.length) best = candidates[0];

      if (best) console.log(`Top license candidate (upload): ${best}`);
      else
        console.log(
          `No obvious license candidate detected for uploaded file: ${file.path}`
        );
    } catch (e) {
      console.warn("Failed to log OCR debug info:", e && e.message);
    }

    return res.json({
      success: true,
      ocrText: raw,
      qr: qrResult,
      keywordsFound: keywords,
      licenseCandidates: candidates,
      quality,
      message: keywords.length
        ? "Document contains drug-license related keywords"
        : "No obvious drug-license keywords detected",
    });
  } catch (error) {
    console.error("Drug license verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Drug license verification failed",
      error: error && error.message,
    });
  }
};
