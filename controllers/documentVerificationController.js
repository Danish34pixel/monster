const path = require("path");
const { uploadToCloudinary } = require("../config/cloudinary");

let Tesseract;
try {
  Tesseract = require("tesseract.js");
} catch (e) {
  Tesseract = null;
}

let Jimp;
let jsQR;
try {
  Jimp = require("jimp");
  jsQR = require("jsqr");
} catch (e) {
  Jimp = null;
  jsQR = null;
}

const AADHAAR_REGEX = /(?:\b|^)(?:\d[ -]*?){12}(?:\b|$)/g;
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

async function runOcr(filePath) {
  const worker = Tesseract.createWorker({ logger: () => {} });
  await worker.load();
  await worker.loadLanguage("eng");
  await worker.initialize("eng");
  const {
    data: { text },
  } = await worker.recognize(path.resolve(filePath));
  await worker.terminate();
  return String(text || "");
}

exports.verifyDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use form field `document`.",
      });
    }

    if (!Tesseract) {
      return res.status(501).json({
        success: false,
        message: "OCR provider is not installed.",
      });
    }

    const file = req.file;
    let cloudUrl = null;
    try {
      const r = await uploadToCloudinary(file, "documents");
      cloudUrl = r.url;
    } catch (e) {
      cloudUrl = null;
    }

    const raw = await runOcr(file.path);
    const matches = [];
    let m;
    while ((m = AADHAAR_REGEX.exec(raw)) !== null) {
      matches.push(m[0].replace(/\D/g, ""));
    }

    return res.json({
      success: true,
      aadharCandidates: matches,
      quality: {
        sizeBytes: file.size,
        mime: file.mimetype,
        cloudUrl,
      },
      message: matches.length
        ? "Possible Aadhaar number(s) found"
        : "No Aadhaar-like number found in OCR",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Document verification failed",
    });
  }
};

exports.verifyDrugLicense = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use form field `document`.",
      });
    }

    if (!Tesseract) {
      return res.status(501).json({
        success: false,
        message: "OCR provider is not installed.",
      });
    }

    const file = req.file;
    let cloudUrl = null;
    try {
      const r = await uploadToCloudinary(file, "documents/drug-licenses");
      cloudUrl = r.url;
    } catch (e) {
      cloudUrl = null;
    }

    let qrResult = null;
    if (Jimp && jsQR) {
      try {
        const image = await Jimp.read(path.resolve(file.path));
        const { data, width, height } = image.bitmap;
        const code = jsQR(new Uint8ClampedArray(data), width, height);
        if (code) {
          qrResult = { raw: code.data };
        }
      } catch (e) {
        qrResult = null;
      }
    }

    const raw = await runOcr(file.path);
    const keywords = DRUG_KEYWORDS.filter((rx) => rx.test(raw)).map((r) => r.source);

    const candidates = [];
    let m;
    while ((m = DRUG_LICENSE_REGEX.exec(raw)) !== null) {
      const token = m[0].trim();
      if (token.length >= 6 && token.length <= 25) candidates.push(token);
    }

    return res.json({
      success: true,
      qr: qrResult,
      keywordsFound: keywords,
      licenseCandidates: candidates,
      quality: { sizeBytes: file.size, mime: file.mimetype, cloudUrl },
      message: keywords.length
        ? "Document contains drug-license related keywords"
        : "No obvious drug-license keywords detected",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Drug license verification failed",
    });
  }
};
