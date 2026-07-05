const multer = require("multer");
const path = require("path");
const fs = require("fs");
let fileTypeModulePromise;

async function detectFileType(filePath) {
  // file-type v19+ is ESM-only, so load it lazily from CommonJS.
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import("file-type");
  }
  const mod = await fileTypeModulePromise;
  return mod.fileTypeFromFile(filePath);
}

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".pdf"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`,
    );
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error("Unsupported file extension."), false);
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error("Unsupported file type."), false);
  }

  return cb(null, true);
};

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 4,
  },
});

function collectFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    Object.values(req.files).forEach((val) => {
      if (Array.isArray(val)) files.push(...val);
      else if (val) files.push(val);
    });
  }
  return files;
}

async function removeFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    // best effort cleanup
  }
}

const validateUploadedFiles = async (req, res, next) => {
  try {
    const files = collectFiles(req);
    for (const file of files) {
      const detected = await detectFileType(file.path);
      const detectedMime = detected && detected.mime;
      if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
        await removeFileIfExists(file.path);
        return res.status(400).json({
          success: false,
          message: "Invalid file content. Only JPG, PNG, and PDF are allowed.",
        });
      }
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is ${Math.round(
          MAX_UPLOAD_SIZE_BYTES / 1024 / 1024,
        )}MB.`,
      });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files uploaded.",
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${error.message}`,
    });
  }

  if (
    error.message === "Unsupported file type." ||
    error.message === "Unsupported file extension."
  ) {
    return res.status(400).json({
      success: false,
      message: "Only JPG, PNG, and PDF files are allowed.",
    });
  }

  return next(error);
};

const cleanupUploads = (req, res, next) => {
  res.on("finish", () => {
    const files = collectFiles(req);
    files.forEach((f) => {
      if (!f || !f.path) return;
      fs.unlink(f.path, () => {});
    });
  });
  return next();
};

// ── Ad upload (images + video, 50 MB) ────────────────────────────────────────

const AD_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const AD_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"]);
const AD_MAX_SIZE_BYTES = 50 * 1024 * 1024;

const adFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!AD_ALLOWED_EXT.has(ext)) return cb(new Error("Unsupported file extension."), false);
  if (!AD_ALLOWED_MIME.has(file.mimetype)) return cb(new Error("Unsupported file type."), false);
  return cb(null, true);
};

const adUpload = multer({
  storage,
  fileFilter: adFileFilter,
  limits: { fileSize: AD_MAX_SIZE_BYTES, files: 1 },
});

module.exports = {
  upload,
  adUpload,
  validateUploadedFiles,
  handleUploadError,
  cleanupUploads,
};
