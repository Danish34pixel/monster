const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("../../models/User");

async function main() {
  const uri =
    process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set in environment");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const email = "test-reset@example.com";
  const plain = "OldPass123!";

  const salt = await bcrypt.genSalt(12);
  const hashed = await bcrypt.hash(plain, salt);

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      medicalName: "Test Medical",
      ownerName: "Test Owner",
      // Ensure address is a string (schema expects a string) for test user
      address: "123 Test St",
      email,
      contactNo: "9999999999",
      drugLicenseNo: `TEST${Date.now()}`,
      // Provide a placeholder image URL so schema validation for drugLicenseImage passes
      drugLicenseImage: "https://via.placeholder.com/600x400.png?text=License",
      password: hashed,
    });
    await user.save();
    console.log("Created test user:", email);
  } else {
    user.password = hashed;
    await user.save();
    console.log("Updated password for existing user:", email);
  }

  console.log("You can now use email:", email, "with password:", plain);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
