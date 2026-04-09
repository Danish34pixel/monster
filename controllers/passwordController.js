const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const { sendMail } = require("../utils/mailer");

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function findAccountByEmail(email) {
  const normalizedEmail = email.toLowerCase();
  const accountInUser = await User.findOne({ email: normalizedEmail });
  if (accountInUser) return { model: User, account: accountInUser };

  const accountInStockist = await Stockist.findOne({ email: normalizedEmail });
  if (accountInStockist) return { model: Stockist, account: accountInStockist };

  const accountInPurchaser = await Purchaser.findOne({ email: normalizedEmail });
  if (accountInPurchaser) return { model: Purchaser, account: accountInPurchaser };

  return null;
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const found = await findAccountByEmail(email);
    if (!found) {
      return res.status(200).json({
        success: true,
        message: "If an account exists, a reset email has been sent.",
      });
    }

    const token = generateResetToken();
    const expires = Date.now() + 15 * 60 * 1000;

    await found.model.updateOne(
      { _id: found.account._id },
      {
        $set: {
          resetPasswordToken: hashToken(token),
          resetPasswordExpires: new Date(expires),
        },
      },
      { strict: false }
    );

    const base = (process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
    const frontendBase = base || "http://localhost:5173";
    const resetUrl = `${frontendBase}/reset-password?token=${token}&email=${encodeURIComponent(
      found.account.email
    )}`;

    await sendMail({
      to: found.account.email,
      subject: "Password reset request",
      html: `<p>You requested a password reset.</p><p>This link expires in 15 minutes:</p><p><a href="${resetUrl}">Reset password</a></p>`,
      text: `Reset password: ${resetUrl}`,
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    });

    return res.json({
      success: true,
      message: "If an account exists, a reset email has been sent.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

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
    const stored = String(user.resetPasswordToken);
    const bufA = Buffer.from(hashedIncoming);
    const bufB = Buffer.from(stored);
    const valid = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

    if (!valid) {
      return res.status(400).json({ success: false, message: "Invalid token or email" });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { forgotPassword, resetPassword };
