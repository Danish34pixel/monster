const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create uploads directory if it doesn't exist
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 4, // allow multiple files per request (image + aadharCard)
  },
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 5MB.",
      });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files. Only 1 file allowed.",
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${error.message}`,
    });
  }

  if (error.message === "Only image files are allowed!") {
    return res.status(400).json({
      success: false,
      message: "Only image files (JPG, PNG, GIF) are allowed.",
    });
  }

  next(error);
};

// Clean up uploaded files after processing
const cleanupUploads = (req, res, next) => {
  // Clean up uploaded files after response is sent
  res.on("finish", () => {
    // single-file field
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting uploaded file:", err);
      });
    }

    // multiple fields (upload.fields) stored in req.files as arrays
    if (req.files) {
      const removeIf = (f) => {
        try {
          if (f && f.path) fs.unlinkSync(f.path);
        } catch (err) {
          // log and continue
          console.error(
            "Error deleting uploaded file (req.files):",
            err && err.message
          );
        }
      };

      Object.keys(req.files).forEach((key) => {
        const val = req.files[key];
        if (Array.isArray(val)) {
          val.forEach(removeIf);
        } else if (val && val.path) {
          removeIf(val);
        }
      });
    }
  });
  next();
};

module.exports = {
  upload,
  handleUploadError,
  cleanupUploads,
};
