const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const Stockist = require("../models/Stockist");
const Staff = require("../models/Staff");
const Otp = require("../models/Otp");
const { sendMail } = require("../utils/mailer");
const {
  issueAccessToken,
  issueRefreshToken,
  buildTokenPayload,
} = require("../utils/tokenService");

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function isPhoneLike(value) {
  return /^\+?[0-9]{7,15}$/.test(String(value || ""));
}

function normalizeIdentifier(identifier) {
  const value = String(identifier || "")
    .trim()
    .toLowerCase();
  if (isEmailLike(value)) return { type: "email", value };
  if (isPhoneLike(value)) return { type: "phone", value };
  return { type: "unknown", value };
}

function sanitizeUser(userDoc, role) {
  if (!userDoc) return null;
  const obj =
    typeof userDoc.toObject === "function"
      ? userDoc.toObject()
      : { ...userDoc };
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  if (role) obj.role = role;
  return obj;
}

function buildIdentifierQuery(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") {
    return {
      $or: [
        {
          email: String(identifier || "")
            .trim()
            .toLowerCase(),
        },
      ],
    };
  }

  const value = normalized.value;
  return {
    $or: [
      { email: value },
      { contactNo: value },
      { phone: value },
      { contact: value },
    ],
  };
}

async function findUserByIdentifier(identifier, role) {
  if (!role) {
    return findUserByIdentifierAnyRole(identifier);
  }

  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") return null;

  const query = buildIdentifierQuery(identifier);

  if (role === "stockist") {
    const stockist = await Stockist.findOne(query).select("+password");
    if (!stockist || !stockist.password) return null;
    return { role: "stockist", user: stockist };
  }

  if (role === "purchaser") {
    const purchaser = await Purchaser.findOne(query).select("+password");
    if (!purchaser || !purchaser.password) return null;
    return { role: "purchaser", user: purchaser };
  }

  if (role === "staff") {
    const staff = await Staff.findOne(query).select("+password");
    if (!staff || !staff.password) return null;
    return { role: "staff", user: staff };
  }

  const owner = await User.findOne(query).select("+password");
  if (!owner || !owner.password) return null;
  return { role: owner.role || "user", user: owner };
}

async function findUserByIdentifierAnyRole(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") return null;

  const query = buildIdentifierQuery(identifier);

  const [owner, stockist, purchaser, staff] = await Promise.all([
    User.findOne(query).select("+password"),
    Stockist.findOne(query).select("+password"),
    Purchaser.findOne(query).select("+password"),
    Staff.findOne(query).select("+password"),
  ]);

  if (owner && owner.password)
    return { role: owner.role || "user", user: owner };
  if (stockist && stockist.password)
    return { role: "stockist", user: stockist };
  if (purchaser && purchaser.password)
    return { role: "purchaser", user: purchaser };
  if (staff && staff.password) return { role: "staff", user: staff };
  return null;
}

function createOtpCode() {
  return crypto.randomInt(100000, 999999).toString();
}

async function hashOtp(otp) {
  return bcrypt.hash(String(otp), 10);
}

async function compareOtp(rawOtp, hashOtpValue) {
  return bcrypt.compare(String(rawOtp), String(hashOtpValue));
}

async function sendOtpByIdentifier(identifier, otp) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "email") {
    await sendMail({
      to: normalized.value,
      subject: "Your MedTrap OTP",
      text: `Your OTP is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your OTP is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
    });
    return;
  }

  if (normalized.type === "phone") {
    if (process.env.SMS_PROVIDER === "twilio") {
      // Intentionally no-op in this environment; callers can plug in a provider later.
    }
  }
}

async function createOtpRecord({ userId, identifier, purpose }) {
  const otp = createOtpCode();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const previousOtp = await Otp.findOne({
    userId,
    purpose,
    isUsed: false,
  }).sort({ createdAt: -1 });
  if (previousOtp) {
    previousOtp.resendCount = (previousOtp.resendCount || 0) + 1;
    await previousOtp.save();
  }

  await Otp.updateMany(
    { userId, purpose, isUsed: false },
    { $set: { isUsed: true } },
  );

  const otpRecord = await Otp.create({
    userId,
    identifier: String(identifier).trim().toLowerCase(),
    otpHash,
    purpose,
    expiresAt,
    attempts: 0,
    resendCount: 0,
    isUsed: false,
  });

  await sendOtpByIdentifier(identifier, otp);
  return otpRecord;
}

async function sendOtp({ identifier, purpose = "login", userId }) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") {
    const error = new Error("Please provide a valid email or phone number.");
    error.statusCode = 400;
    throw error;
  }

  const account = await findUserByIdentifierAnyRole(identifier);
  if (!account) {
    const error = new Error("No account found for the provided identifier.");
    error.statusCode = 404;
    throw error;
  }

  const latestOtp = await Otp.findOne({
    userId: account.user._id,
    purpose,
    isUsed: false,
  }).sort({ createdAt: -1 });
  if (latestOtp && latestOtp.resendCount >= MAX_RESENDS) {
    const error = new Error(
      "OTP resend limit exceeded. Please try again later.",
    );
    error.statusCode = 429;
    throw error;
  }

  const otpRecord = await createOtpRecord({
    userId: account.user._id,
    identifier,
    purpose,
  });

  console.info("auth.otp.sent", {
    userId: account.user._id,
    purpose,
    identifier: normalized.value,
  });
  return { success: true, message: "OTP Sent" };
}

async function verifyOtp({ identifier, otp, purpose = "login" }) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") {
    const error = new Error("Please provide a valid email or phone number.");
    error.statusCode = 400;
    throw error;
  }

  const account = await findUserByIdentifierAnyRole(identifier);
  if (!account) {
    const error = new Error("No account found for the provided identifier.");
    error.statusCode = 404;
    throw error;
  }

  const otpRecord = await Otp.findOne({
    userId: account.user._id,
    identifier: normalized.value,
    purpose,
    isUsed: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    const error = new Error("OTP not found or already used.");
    error.statusCode = 404;
    throw error;
  }

  if (otpRecord.expiresAt < new Date()) {
    otpRecord.isUsed = true;
    await otpRecord.save();
    const error = new Error("OTP has expired.");
    error.statusCode = 410;
    throw error;
  }

  if (otpRecord.attempts >= MAX_ATTEMPTS) {
    otpRecord.isUsed = true;
    await otpRecord.save();
    const error = new Error("Maximum OTP attempts reached.");
    error.statusCode = 429;
    throw error;
  }

  const isValidOtp = await compareOtp(otp, otpRecord.otpHash);
  otpRecord.attempts += 1;
  if (!isValidOtp) {
    await otpRecord.save();
    const error = new Error("Invalid OTP.");
    error.statusCode = 401;
    throw error;
  }

  otpRecord.isUsed = true;
  await otpRecord.save();

  console.info("auth.otp.verified", {
    userId: account.user._id,
    purpose,
    identifier: normalized.value,
  });
  const payload = buildTokenPayload(account.user, account.role);
  const accessToken = issueAccessToken(payload);
  const refreshToken = issueRefreshToken(payload);

  return {
    success: true,
    message: "OTP verified successfully",
    accessToken,
    refreshToken,
    user: sanitizeUser(account.user, account.role),
    role: account.role,
  };
}

async function loginWithPassword({ identifier, password, role }) {
  const account = role
    ? await findUserByIdentifier(identifier, role)
    : await findUserByIdentifierAnyRole(identifier);
  if (!account) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, String(account.user.password));
  if (!isMatch) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  if (account.role === "stockist") {
    if (account.user.status !== "approved") {
      const error = new Error(
        account.user.status === "declined"
          ? "Your registration was declined by admin."
          : "Your account is under review. Please wait for admin approval.",
      );
      error.statusCode = 403;
      throw error;
    }
  }

  if (account.role === "staff") {
    const status =
      account.user.approvalStatus ||
      (account.user.approved ? "approved" : "pending");
    if (status !== "approved") {
      const error = new Error(
        status === "declined"
          ? "Your staff request was declined by the selected organization."
          : "Your staff account is pending approval from your organization.",
      );
      error.statusCode = 403;
      throw error;
    }
  }

  const payload = buildTokenPayload(account.user, account.role);
  return {
    success: true,
    message: "Login successful",
    accessToken: issueAccessToken(payload),
    refreshToken: issueRefreshToken(payload),
    user: sanitizeUser(account.user, account.role),
    role: account.role,
  };
}

async function resetPasswordWithOtp({
  identifier,
  otp,
  newPassword,
  purpose = "reset",
}) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "unknown") {
    const error = new Error("Please provide a valid email or phone number.");
    error.statusCode = 400;
    throw error;
  }

  const account = await findUserByIdentifierAnyRole(identifier);
  if (!account) {
    const error = new Error("No account found for the provided identifier.");
    error.statusCode = 404;
    throw error;
  }

  const otpRecord = await Otp.findOne({
    userId: account.user._id,
    identifier: normalized.value,
    purpose,
    isUsed: false,
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    const error = new Error("OTP not found or already used.");
    error.statusCode = 404;
    throw error;
  }

  if (otpRecord.expiresAt < new Date()) {
    otpRecord.isUsed = true;
    await otpRecord.save();
    const error = new Error("OTP has expired.");
    error.statusCode = 410;
    throw error;
  }

  if (otpRecord.attempts >= MAX_ATTEMPTS) {
    otpRecord.isUsed = true;
    await otpRecord.save();
    const error = new Error("Maximum OTP attempts reached.");
    error.statusCode = 429;
    throw error;
  }

  const isValidOtp = await compareOtp(otp, otpRecord.otpHash);
  otpRecord.attempts += 1;
  if (!isValidOtp) {
    await otpRecord.save();
    const error = new Error("Invalid OTP.");
    error.statusCode = 401;
    throw error;
  }

  otpRecord.isUsed = true;
  await otpRecord.save();

  console.info("auth.password.reset", {
    userId: account.user._id,
    identifier: normalized.value,
  });
  const hashedPassword = await bcrypt.hash(String(newPassword), 12);
  account.user.password = hashedPassword;
  await account.user.save();

  return { success: true, message: "Password reset successfully" };
}

module.exports = {
  sanitizeUser,
  findUserByIdentifier,
  findUserByIdentifierAnyRole,
  normalizeIdentifier,
  sendOtp,
  verifyOtp,
  loginWithPassword,
  resetPasswordWithOtp,
  isEmailLike,
  isPhoneLike,
};
