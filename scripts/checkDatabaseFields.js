const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function checkData() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/meditrap";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    const db = mongoose.connection.db;

    console.log("\n--- Checking Medicines ---");
    const meds = await db.collection("medicines").find().limit(2).toArray();
    console.log(JSON.stringify(meds, null, 2));

    console.log("\n--- Checking Stockists ---");
    const stockists = await db.collection("stockists").find().limit(2).toArray();
    console.log(JSON.stringify(stockists, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error("Error checking data:", err);
    process.exit(1);
  }
}

checkData();
