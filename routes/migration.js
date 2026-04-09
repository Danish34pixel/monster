const express = require("express");
const router = express.Router();
const migrationController = require("../controllers/migrationController");
const { authenticate, isAdmin } = require("../middleware/auth");

// Protected dry-run backfill report
router.get(
  "/backfill",
  authenticate,
  isAdmin,
  migrationController.backfillDryRun
);

module.exports = router;
