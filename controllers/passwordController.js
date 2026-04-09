const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const { sendMail } = require("../utils/mailer");

// Generate a secure random token (hex)
function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// POST /api/auth/forgot-password
// body: { email }
async function forgotPassword(req, res) {
  try {
    console.log("[forgotPassword] Handler reached");
    if (process.env.NODE_ENV === "development") {
      try {
        console.log("[forgotPassword] Incoming request:", {
          origin: req.headers.origin,
          ip: req.ip,
          body: req.body,
        });
      } catch (e) {
        console.log("[forgotPassword] Debug log failed", e && e.message);
      }
    }
    const { email } = req.body;
    console.log("[forgotPassword] Email from body:", email);
    if (!email) {
      console.log("[forgotPassword] No email provided");
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    // Try to find the account in User first, then in Stockist.
    const normalizedEmail = email.toLowerCase();
    let account = await User.findOne({ email: normalizedEmail }).lean();
    let accountModel = User;
    if (!account) {
      account = await Stockist.findOne({ email: normalizedEmail }).lean();
      accountModel = Stockist;
    }
    console.log(
      "[forgotPassword] Account found:",
      !!account,
      "model:",
      accountModel.modelName
    );
    if (!account) {
      console.log("[forgotPassword] No user found for email");
      return res.status(200).json({
        success: true,
        message: "If an account exists, a reset email has been sent.",
      });
    }

    const token = generateResetToken();
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
    console.log("[forgotPassword] Generated token:", token);

    // Save the hashed token and expiry on whichever model owns the account.
    await accountModel.updateOne(
      { _id: account._id },
      {
        $set: {
          resetPasswordToken: hashToken(token),
          resetPasswordExpires: new Date(expires),
        },
      }
    );
    console.log(
      "[forgotPassword] Token and expiry saved to account (model:",
      accountModel.modelName,
      ")"
    );

    // Prefer an explicit FRONTEND_BASE_URL, then FRONTEND_URL (single URL),
    // then fall back to either a localhost dev URL or the known Vercel frontend.
    const rawFrontendBase =
      process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || null;
    const defaultFrontend =
      process.env.NODE_ENV === "development" ? "http://localhost:5173" : null;
    // Helper to check dev/localhost-like values
    function looksLocalhost(u) {
      if (!u) return false;
      try {
        return /localhost|127\.0\.0\.1|0\.0\.0\.0|:5173|:3000/.test(String(u));
      } catch (e) {
        return false;
      }
    }

    // Start with explicit env value or default
    let normalizedBase = rawFrontendBase
      ? String(rawFrontendBase).replace(/\/+$/, "")
      : defaultFrontend;
    // If still null in production, fall back to backend origin when available
    if (!normalizedBase && req && req.headers && req.headers.host) {
      const proto = req.protocol || req.headers["x-forwarded-proto"] || "http";
      normalizedBase = `${proto}://${req.headers.host}`;
    }
    // Last-resort fallback to a safe literal only if nothing else is available
    if (!normalizedBase) normalizedBase = "http://localhost:5173";

    // If the configured base looks like a local/dev URL, try to use the incoming Origin
    // header (only if it's in the runtime allowlist exposed as global.__ALLOWED_ORIGINS__)
    const incomingOrigin =
      req.headers && req.headers.origin
        ? String(req.headers.origin).replace(/\/+$/, "")
        : null;
    try {
      const allowed = Array.isArray(global.__ALLOWED_ORIGINS__)
        ? global.__ALLOWED_ORIGINS__
        : [];
      if (
        looksLocalhost(normalizedBase) &&
        incomingOrigin &&
        allowed.includes(incomingOrigin)
      ) {
        normalizedBase = incomingOrigin;
      }
    } catch (e) {
      // ignore and keep normalizedBase
    }

    const resetUrl = `${normalizedBase}/reset-password?token=${token}&email=${encodeURIComponent(
      account.email
    )}`;
    console.log("[forgotPassword] Reset URL:", resetUrl);

    const html = `<p>You (or someone else) requested a password reset.</p>
      <p>Click this link to reset your password. This link expires in 15 minutes:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>`;

    let mailResult = null;
    try {
      console.log(
        "[forgotPassword] About to call sendMail for:",
        account.email
      );
      mailResult = await sendMail({
        to: account.email,
        subject: "Password reset request",
        html,
        text: `Reset your password using this link: ${resetUrl}`,
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      });
      console.log("[forgotPassword] sendMail result:", mailResult);
    } catch (mailErr) {
      console.error(
        "[forgotPassword] sendMail failed",
        mailErr && mailErr.message
      );
      // Keep the default behavior of not revealing delivery status to callers.
      // However, allow opt-in debug output in the response when DEBUG_EMAIL=true.
      mailResult = { previewUrl: null };
      if (
        process.env.DEBUG_EMAIL === "true" ||
        process.env.NODE_ENV === "development"
      ) {
        // Attach debug field to response so operators can see why delivery failed.
        return res.status(200).json({
          success: true,
          message: "If an account exists, a reset email has been sent.",
          debug: { mailError: mailErr && (mailErr.message || String(mailErr)) },
        });
      }
    }

    try {
      const previewUrl =
        mailResult && mailResult.previewUrl ? mailResult.previewUrl : null;
      if (previewUrl)
        console.log("[forgotPassword] Ethereal preview URL:", previewUrl);
    } catch (e) {
      // ignore
    }

    console.log("[forgotPassword] Responding to client");
    // Optionally include debug info (reset URL / preview URL) when debugging is enabled.
    if (
      process.env.DEBUG_EMAIL === "true" ||
      process.env.NODE_ENV === "development"
    ) {
      const previewUrl =
        mailResult && mailResult.previewUrl ? mailResult.previewUrl : null;
      return res.json({
        success: true,
        message: "If an account exists, a reset email has been sent.",
        debug: { resetUrl, previewUrl },
      });
    }

    res.json({
      success: true,
      message: "If an account exists, a reset email has been sent.",
    });
  } catch (err) {
    console.error("[forgotPassword] error:", err);
    if (process.env.NODE_ENV === "development") {
      return res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
        stack: err.stack,
      });
    }
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/auth/reset-password
// body: { token, email, newPassword }
async function resetPassword(req, res) {
  try {
    // Accept token/email from either body (POST) or query (GET)
    const token = req.body.token || req.query.token;
    const email = req.body.email || req.query.email;
    const newPassword = req.body.newPassword;
    console.log("[resetPassword] Called with:", { token, email });
    console.log("[resetPassword] Called with:", { token, email });
    if (!token || !email || !newPassword) {
      console.log("[resetPassword] Missing required fields");
      return res.status(400).json({
        success: false,
        message: "token, email and newPassword are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+resetPasswordToken +resetPasswordExpires"
    );
    console.log("[resetPassword] User found:", !!user);
    if (!user) {
      console.log("[resetPassword] No user found for email");
      return res
        .status(400)
        .json({ success: false, message: "Invalid token or email" });
    }

    console.log("[resetPassword] Token in DB:", user.resetPasswordToken);
    console.log("[resetPassword] Expiry in DB:", user.resetPasswordExpires);
    console.log("[resetPassword] Current time:", new Date());
    if (
      !user.resetPasswordExpires ||
      user.resetPasswordExpires.getTime() < Date.now()
    ) {
      console.log("[resetPassword] Token expired");
      return res.status(400).json({ success: false, message: "Token expired" });
    }

    const hashed = hashToken(token);
    const stored = user.resetPasswordToken || "";
    console.log("[resetPassword] Hashed incoming token:", hashed);
    console.log("[resetPassword] Stored token:", stored);
    const bufA = Buffer.from(hashed);
    const bufB = Buffer.from(stored);
    const timingSafe =
      bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    console.log("[resetPassword] Token match:", timingSafe);
    if (!timingSafe) {
      console.log("[resetPassword] Invalid token or email");
      return res
        .status(400)
        .json({ success: false, message: "Invalid token or email" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const newHashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = newHashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log("[resetPassword] Password reset successful");
    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("[resetPassword] error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { forgotPassword, resetPassword };
