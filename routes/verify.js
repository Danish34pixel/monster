const express = require("express");
const router = express.Router();
const { upload, validateUploadedFiles } = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");
const {
  verifyDocument,
  verifyDrugLicense,
} = require("../controllers/documentVerificationController");

router.post("/document", authenticate, upload.single("document"), validateUploadedFiles, verifyDocument);
router.post("/drug-license", authenticate, upload.single("document"), validateUploadedFiles, verifyDrugLicense);

module.exports = router;
