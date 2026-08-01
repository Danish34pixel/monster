const express = require("express");
const router = express.Router();
const {
  upload,
  validateUploadedFiles,
  cleanupUploads,
} = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");
const {
  verifyDocument,
  verifyDrugLicense,
} = require("../controllers/documentVerificationController");

const VERIFICATION_FIELDS = [
  { name: "document", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "image", maxCount: 1 },
  { name: "media", maxCount: 1 },
  { name: "drugLicenseImage", maxCount: 1 },
];

const normalizeVerificationFile = (req, res, next) => {
  const candidates = [
    req.file,
    req.files?.document?.[0],
    req.files?.file?.[0],
    req.files?.image?.[0],
    req.files?.media?.[0],
    req.files?.drugLicenseImage?.[0],
  ].filter(Boolean);

  if (candidates.length > 0) {
    [req.file] = candidates;
  }

  return next();
};

router.post(
  "/document",
  authenticate,
  upload.fields(VERIFICATION_FIELDS),
  normalizeVerificationFile,
  validateUploadedFiles,
  cleanupUploads,
  verifyDocument,
);
router.post(
  "/drug-license",
  authenticate,
  upload.fields(VERIFICATION_FIELDS),
  normalizeVerificationFile,
  validateUploadedFiles,
  cleanupUploads,
  verifyDrugLicense,
);

module.exports = router;
