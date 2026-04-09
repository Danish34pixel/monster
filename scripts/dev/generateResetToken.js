const mongoose = require("mongoose");
const crypto = require("crypto");
require("dotenv").config();

const User = require("../../models/User");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function main() {
  const uri =
    process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set in environment");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const email = "test-reset@example.com";
  const user = await User.findOne({ email });
  if (!user) {
    console.error(
      "Test user not found. Run scripts/dev/createTestUser.js first."
    );
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = hashToken(token);
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();

  console.log("Generated reset token (raw). Use this in the reset API call:");
  console.log(token);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
