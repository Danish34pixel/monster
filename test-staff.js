const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

// Load env
const envPath = path.join(__dirname, ".env");
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error("dotenv error:", result.error);
}
console.log("Parsed keys:", result.parsed ? Object.keys(result.parsed) : "none");

const Staff = require("./models/Staff");

async function test() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
    console.log("Connecting to:", mongoUri);
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB");

    const filter = {};
    console.log("Running Staff.find(filter)...");
    const data = await Staff.find(filter).sort({ createdAt: -1 }).lean().exec();
    console.log("Success! Found", data.length, "staff members.");
    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

test();
