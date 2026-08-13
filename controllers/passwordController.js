const bcrypt = require("bcryptjs");
const { sendMail } = require("../utils/mailer");
const { buildPasswordResetEmail } = require("../utils/emailTemplete");
const { hashToken, RESET_TOKEN_TTL_MS } = require("../utils/passwordResetToken");
const {
  timingSafeStringsEqual,
  displayNameFor,
  findAccountByEmail,
  findAccountByResetToken,
} = require("../services/passwordResetService");

// The reset-password page is now served directly by this backend — see
// routes/resetPasswordPage.js (GET/POST /reset-password/:token) — so the
// emailed link no longer depends on a separately-hosted frontend at all.
// Override via RESET_PASSWORD_BASE_URL for local/staging testing (e.g.
// http://localhost:5002); defaults to the real production API domain so a
// missing/misconfigured env var can never silently produce a localhost link.
function resetPasswordPageBaseUrl() {
  const base = (process.env.RESET_PASSWORD_BASE_URL || "https://api.medi-trap.com").replace(/\/+$/, "");
  console.log("resetPasswordPageBaseUrl() result:", base);
  return base;
}

const GENERIC_FORGOT_MESSAGE =
  "If an account exists with this email, a password reset link has been sent.";

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const found = await findAccountByEmail(email);
    // Never reveal whether the email exists — same response either way.
    if (!found) {
      return res.status(200).json({ success: true, message: GENERIC_FORGOT_MESSAGE });
    }

    // Instance method (shared across User/Stockist/Purchaser/Staff via the
    // passwordResetToken plugin): generates the raw token, stores only its
    // SHA-256 hash + a 15-minute expiry on the document.
    const token = found.account.generatePasswordResetToken();
    await found.account.save({ validateModifiedOnly: true });

    const resetUrl = `${resetPasswordPageBaseUrl()}/reset-password/${token}`;
    console.log("Generated reset URL:", resetUrl);

    const { subject, html, text } = buildPasswordResetEmail({
      name: displayNameFor(found.account),
      resetUrl,
      expiryMinutes: RESET_TOKEN_TTL_MS / 60000,
    });

    // Confirms the exact URL that made it into the email body — html/text
    // both interpolate the same `resetUrl` closed over above, so this is
    // provably the link the recipient will see, not a re-derived value.
    console.log("About to call sendMail() with resetUrl:", resetUrl);

    try {
      await sendMail({
        to: found.account.email,
        subject,
        html,
        text,
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM,
      });
    } catch (mailErr) {
      // Don't leak email-delivery failures to the client — that would let an
      // attacker distinguish valid accounts by provoking SMTP errors. Full
      // diagnostics still go to the server log so a 535 (bad credentials) or
      // similar is immediately actionable from there.
      console.error("forgotPassword: sendMail failed:", {
        message: mailErr && mailErr.message,
        code: mailErr && mailErr.code,
        responseCode: mailErr && mailErr.responseCode,
        response: mailErr && mailErr.response,
        command: mailErr && mailErr.command,
      });
    }

    return res.status(200).json({ success: true, message: GENERIC_FORGOT_MESSAGE });
  } catch (err) {
    console.error("forgotPassword error:", err && err.message);
    // Still return the generic response — no information leakage on error either.
    return res.status(200).json({ success: true, message: GENERIC_FORGOT_MESSAGE });
  }
}

// POST /api/auth/reset-password/:token  { password, confirmPassword }
// JSON API variant — kept for any programmatic/native-app callers. The
// user-facing email link now points at the server-rendered HTML page
// instead (routes/resetPasswordPage.js), which shares the same account
// lookup/token logic via services/passwordResetService.js.
async function resetPasswordWithToken(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    const { password, confirmPassword } = req.body;

    if (!token || token.length < 20) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match." });
    }

    const hashedIncoming = hashToken(token);
    const found = await findAccountByResetToken(hashedIncoming);

    if (!found || !found.account.resetPasswordToken || !found.account.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }

    // Belt-and-braces: confirm the stored hash matches via a timing-safe
    // comparison even though the DB lookup already matched on it exactly.
    if (!timingSafeStringsEqual(hashedIncoming, found.account.resetPasswordToken)) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }

    if (new Date(found.account.resetPasswordExpires).getTime() < Date.now()) {
      // Clear the stale token so it can't be reused even if somehow re-derived.
      await found.model.updateOne(
        { _id: found.account._id },
        { $unset: { resetPasswordToken: "", resetPasswordExpires: "" } },
        { strict: false },
      );
      return res.status(400).json({ success: false, message: "This reset link has expired. Please request a new one." });
    }

    const account = await found.model
      .findById(found.account._id)
      .select("+resetPasswordToken +resetPasswordExpires +password");

    account.password = await bcrypt.hash(password, 12);
    account.clearPasswordResetToken();
    await account.save({ validateModifiedOnly: true });

    return res.json({ success: true, message: "Password reset successful. Please sign in with your new password." });
  } catch (err) {
    console.error("resetPasswordWithToken error:", err && err.message);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
}

// POST /api/auth/reset-password  { token, email, newPassword }
// Legacy body-based variant — kept for backward compatibility with any
// existing callers.
async function resetPassword(req, res) {
  try {
    const { token, email, newPassword } = req.body;

    const found = await findAccountByEmail(email);
    if (!found) {
      return res.status(400).json({ success: false, message: "Invalid token or email" });
    }

    const user = await found.model
      .findById(found.account._id)
      .select("+resetPasswordToken +resetPasswordExpires +password");

    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: "Invalid token or email" });
    }

    if (new Date(user.resetPasswordExpires).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Token expired" });
    }

    const hashedIncoming = hashToken(token);
    if (!timingSafeStringsEqual(hashedIncoming, user.resetPasswordToken)) {
      return res.status(400).json({ success: false, message: "Invalid token or email" });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.clearPasswordResetToken();
    await user.save();

    return res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { forgotPassword, resetPassword, resetPasswordWithToken };
