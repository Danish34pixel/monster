// Shared account-lookup helpers for the password-reset flow. Extracted so
// both the JSON API (controllers/passwordController.js) and the
// server-rendered reset page (controllers/resetPasswordPageController.js)
// use the exact same account-resolution logic — one source of truth instead
// of two copies that could drift apart.
const crypto = require("crypto");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const Staff = require("../models/Staff");

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

// Returns { valid: true, found } or { valid: false, reason: "invalid" | "expired" }.
// Read-only — does not clear or modify the token. Used by the GET page
// render to show an error immediately, without waiting for form submission.
async function checkResetToken(hashedToken) {
  const found = await findAccountByResetToken(hashedToken);
  if (!found || !found.account.resetPasswordToken || !found.account.resetPasswordExpires) {
    return { valid: false, reason: "invalid" };
  }
  if (!timingSafeStringsEqual(hashedToken, found.account.resetPasswordToken)) {
    return { valid: false, reason: "invalid" };
  }
  if (new Date(found.account.resetPasswordExpires).getTime() < Date.now()) {
    return { valid: false, reason: "expired", found };
  }
  return { valid: true, found };
}

module.exports = {
  timingSafeStringsEqual,
  displayNameFor,
  findAccountByEmail,
  findAccountByResetToken,
  checkResetToken,
};
