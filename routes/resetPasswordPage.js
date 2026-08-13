const express = require("express");
const { passwordResetLimiter } = require("../middleware/rateLimiters");
const {
  renderResetPasswordPage,
  submitResetPasswordPage,
} = require("../controllers/resetPasswordPageController");

const router = express.Router();

// Mounted at the app root as "/reset-password" (see server.js) — NOT under
// /api — so the emailed link is exactly https://api.medi-trap.com/reset-password/:token.
// Rate-limited on both verbs: GET is read-only but still guards against
// token-enumeration probing; POST guards the actual password-change action.
router.get("/:token", passwordResetLimiter, renderResetPasswordPage);
router.post("/:token", passwordResetLimiter, submitResetPasswordPage);

module.exports = router;
