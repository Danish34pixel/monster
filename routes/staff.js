const express = require("express");
const router = express.Router();
const { upload, validateUploadedFiles } = require("../middleware/upload");
const staffController = require("../controllers/staffController");
const { authenticate } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { staffCreateSchema } = require("../validation/schemas");

router.post(
  "/",
  authenticate,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "aadharCard", maxCount: 1 },
  ]),
  validateBody(staffCreateSchema),
  validateUploadedFiles,
  staffController.createStaff
);

router.get("/", authenticate, staffController.getStaffs);
router.get("/:id", authenticate, staffController.getStaff);
router.delete("/:id", authenticate, staffController.deleteStaff);
router.put("/:id/approve", authenticate, staffController.approveStaff);

module.exports = router;
