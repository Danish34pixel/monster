const crypto = require("crypto");

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

/**
 * Mongoose plugin that adds `generatePasswordResetToken()` and
 * `clearPasswordResetToken()` instance methods to a schema. Requires the
 * schema to already declare `resetPasswordToken` (String) and
 * `resetPasswordExpires` (Date) fields.
 *
 * Kept as a shared plugin (rather than copy-pasted per model) so every
 * account type — User, Stockist, Purchaser, Staff — generates/hashes/expires
 * reset tokens identically.
 */
function passwordResetTokenPlugin(schema) {
  // Returns the raw (unhashed) token to email to the user; only the SHA-256
  // hash is persisted on the document. Caller is responsible for `.save()`.
  schema.methods.generatePasswordResetToken = function generatePasswordResetToken() {
    const rawToken = crypto.randomBytes(32).toString("hex");
    this.resetPasswordToken = hashToken(rawToken);
    this.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    return rawToken;
  };

  schema.methods.clearPasswordResetToken = function clearPasswordResetToken() {
    this.resetPasswordToken = undefined;
    this.resetPasswordExpires = undefined;
  };
}

module.exports = { passwordResetTokenPlugin, hashToken, RESET_TOKEN_TTL_MS };
