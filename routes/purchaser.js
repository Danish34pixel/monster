const express = require("express");
const router = express.Router();
const purchaserController = require("../controllers/purchaserController");
const { authenticate } = require("../middleware/auth");
const {
  upload: uploadAadhar,
  cleanupUploads,
  validateUploadedFiles,
} = require("../middleware/upload");
const { validateBody } = require("../middleware/validate");
const { purchaserCreateSchema } = require("../validation/schemas");
const { authLimiter } = require("../middleware/rateLimiters");

router.post(
  "/",
  authenticate,
  uploadAadhar.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  validateBody(purchaserCreateSchema),
  validateUploadedFiles,
  cleanupUploads,
  purchaserController.createPurchaser
);

router.post("/login", authLimiter, purchaserController.loginPurchaser);
router.get("/", authenticate, purchaserController.list);
router.get("/:id", authenticate, purchaserController.get);
router.delete("/:id", authenticate, purchaserController.delete);

module.exports = router;
