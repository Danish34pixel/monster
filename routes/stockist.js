const express = require("express");
const router = express.Router();

// Controller
const stockistController = require("../controllers/stockistController");

// Auth middleware
const { authenticate, isAdmin } = require("../middleware/auth");
const {
  upload,
  handleUploadError,
  cleanupUploads,
} = require("../middleware/upload");
// sanitizers removed per user request

// GET /api/stockist - list stockists
router.get("/", stockistController.getStockists);

// GET /api/stockist/:id - get single stockist by id
router.get("/:id", stockistController.getStockistById);

// POST /api/stockist - create a new stockist (any authenticated user)
router.post("/", authenticate, stockistController.createStockist);

// POST /api/stockist/register - public registration for stockists (returns token)
router.post(
  "/register",
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "drugLicenseImage", maxCount: 1 },
  ]),
  stockistController.registerStockist,
  handleUploadError,
  cleanupUploads
);

// POST /api/stockist/upload-license - upload license image (multipart) and return Cloudinary URL
router.post(
  "/upload-license",
  authenticate,
  upload.single("licenseImage"),
  stockistController.uploadLicenseImage,
  handleUploadError,
  cleanupUploads
);

// POST /api/stockist/upload-profile - upload profile image
router.post(
  "/upload-profile",
  authenticate,
  upload.single("profileImage"),
  stockistController.uploadProfileImage,
  handleUploadError,
  cleanupUploads
);

// POST /api/stockist/verify-password - verify password and return safe stockist data
router.post("/verify-password", stockistController.verifyStockistPassword);

// PATCH /api/stockist/:id/approve - admin-only: mark a stockist as approved
router.patch(
  "/:id/approve",
  authenticate,
  isAdmin,
  stockistController.approveStockist
);

// PATCH /api/stockist/:id/decline - admin-only: mark a stockist as declined
router.patch(
  "/:id/decline",
  authenticate,
  isAdmin,
  stockistController.declineStockist
);

module.exports = router;
