const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const Staff = require("../models/Staff");
const { sendMail } = require("../utils/mailer");
const { buildPasswordResetEmail } = require("../utils/emailTemplete");
const { hashToken, RESET_TOKEN_TTL_MS } = require("../utils/passwordResetToken");

function timingSafeStringsEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  return bufA.length === bufB.length && bufA.length > 0 && crypto.timingSafeEqual(bufA, bufB);
}

function displayNameFor(account) {
  return (
    account.ownerName ||
    account.medicalName ||
    account.fullName ||
    account.name ||
    account.email
  );
}

function frontendBaseUrl() {
  const base = (process.env.FRONTEND_URL || process.env.FRONTEND_BASE_URL || "").replace(/\/+$/, "");
  return base || "http://localhost:5173";
}

async function findAccountByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  const accountInUser = await User.findOne({ email: normalizedEmail });
  if (accountInUser) return { model: User, account: accountInUser };

  const accountInStockist = await Stockist.findOne({ email: normalizedEmail });
  if (accountInStockist) return { model: Stockist, account: accountInStockist };

  const accountInPurchaser = await Purchaser.findOne({ email: normalizedEmail });
  if (accountInPurchaser) return { model: Purchaser, account: accountInPurchaser };

  const accountInStaff = await Staff.findOne({ email: normalizedEmail });
  if (accountInStaff) return { model: Staff, account: accountInStaff };

  return null;
}

// Looks up an account purely by its hashed reset token (used by the
// link-based reset flow, which only carries the token — not the email — in
// the URL). Each model is checked independently since tokens aren't unique
// across collections.
async function findAccountByResetToken(hashedToken) {
  const models = [User, Stockist, Purchaser, Staff];
  for (const model of models) {
    const account = await model
      .findOne({ resetPasswordToken: hashedToken })
      .select("+resetPasswordToken +resetPasswordExpires +password");
    if (account) return { model, account };
  }
  return null;
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

    const resetUrl = `${frontendBaseUrl()}/reset-password/${token}`;
    const { subject, html, text } = buildPasswordResetEmail({
      name: displayNameFor(found.account),
      resetUrl,
      expiryMinutes: RESET_TOKEN_TTL_MS / 60000,
    });

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
// Token-only lookup for the emailed link flow.
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
