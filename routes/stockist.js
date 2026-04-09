const express = require("express");
const router = express.Router();
const stockistController = require("../controllers/stockistController");
const { authenticate, isAdmin } = require("../middleware/auth");
const {
  upload,
  handleUploadError,
  cleanupUploads,
  validateUploadedFiles,
} = require("../middleware/upload");
const { validateBody } = require("../middleware/validate");
const { stockistCreateSchema } = require("../validation/schemas");

router.get("/", authenticate, stockistController.getStockists);
router.get("/:id", authenticate, stockistController.getStockistById);

router.post("/", authenticate, validateBody(stockistCreateSchema), stockistController.createStockist);

router.post(
  "/register",
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "drugLicenseImage", maxCount: 1 },
  ]),
  validateUploadedFiles,
  stockistController.registerStockist,
  handleUploadError,
  cleanupUploads
);

router.post(
  "/upload-license",
  authenticate,
  upload.single("licenseImage"),
  validateUploadedFiles,
  stockistController.uploadLicenseImage,
  handleUploadError,
  cleanupUploads
);

router.post(
  "/upload-profile",
  authenticate,
  upload.single("profileImage"),
  validateUploadedFiles,
  stockistController.uploadProfileImage,
  handleUploadError,
  cleanupUploads
);

router.post("/verify-password", authenticate, stockistController.verifyStockistPassword);

router.patch("/:id/approve", authenticate, isAdmin, stockistController.approveStockist);
router.patch("/:id/decline", authenticate, isAdmin, stockistController.declineStockist);

module.exports = router;
