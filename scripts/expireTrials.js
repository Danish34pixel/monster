// Optional periodic sweep: flips any account whose 90-day trial has lapsed
// to accountStatus "pending_payment" / paymentRequired true, even if that
// user never makes another request (so e.g. reporting/admin views reflect
// the true state without waiting for the on-request lazy check in
// middleware/auth.js requireActiveAccount or routes/auth.js /login).
//
// This project has no cron/queue runtime (no node-cron/agenda/bullmq
// dependency), so the on-request lazy check is the authoritative
// enforcement mechanism — this script is a defense-in-depth convenience,
// not required for correctness. Run it however the host schedules jobs,
// e.g. a daily Windows Task Scheduler task or a cron entry:
//   node scripts/expireTrials.js
//
// Only touches accounts that are currently "active" and have never
// completed a real paid subscription (subscriptionEndDate unset) — paying
// customers are never affected.

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const Purchaser = require("../models/Purchaser");

async function expireModel(Model, label) {
  const now = new Date();
  const result = await Model.updateMany(
    {
      accountStatus: "active",
      subscriptionEndDate: { $in: [null, undefined] },
      trialEndDate: { $lt: now },
    },
    {
      $set: {
        isTrialActive: false,
        paymentRequired: true,
        accountStatus: "pending_payment",
      },
    },
  );
  console.log(`${label}: expired ${result.modifiedCount} trial account(s)`);
}

async function run() {
  const mongoUri =
    process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI (or MONGODB_URI/DB_URI) not set in .env");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  await expireModel(User, "User");
  await expireModel(Purchaser, "Purchaser");

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error("expireTrials failed:", err);
  process.exit(1);
});
