const express = require("express");
const router = express.Router();
const { upload } = require("../middleware/upload");
const {
  verifyDocument,
  verifyDrugLicense,
} = require("../controllers/documentVerificationController");

// Accept single file field named 'document'
router.post("/document", upload.single("document"), verifyDocument);
router.post("/drug-license", upload.single("document"), verifyDrugLicense);

module.exports = router;
