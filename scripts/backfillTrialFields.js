// One-time migration: backfill trialStartDate/trialEndDate on User and
// Purchaser docs created before the 90-day trial feature existed.
//
// Chosen behavior (confirmed by product owner 2026-07-31): apply the normal
// 90-day math using each doc's original `createdAt` as `trialStartDate`.
// Concretely, for a doc missing `trialStartDate`:
//   trialStartDate = createdAt
//   trialEndDate   = createdAt + 90 days
//   isTrialActive  = now < trialEndDate
//   paymentRequired = !isTrialActive
//
// Accounts that already completed a real paid subscription
// (subscriptionEndDate is set) are NOT touched beyond the trial bookkeeping
// fields — they stay governed by their real subscriptionEndDate, not trial
// math, so a currently-paying customer can never be pushed into
// pending_payment by this script.
//
// Accounts that never paid (accountStatus "active" via the old default, or
// still "pending_payment"/"pending_admin_verification"/"rejected") DO get
// gated: if their computed trial has already lapsed and accountStatus is
// currently "active", it is flipped to "pending_payment" so the existing
// requireActiveAccount / login gates block them until they pay. This is the
// explicitly-accepted risk of the "apply normal 90-day math" option — some
// long-standing free/never-paid accounts may need to pay immediately.
//
// Usage:
//   node scripts/backfillTrialFields.js            (dry run — reports only)
//   node scripts/backfillTrialFields.js --apply    (writes changes)

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const { computeTrialEndDate } = require("../utils/trialStatus");

const APPLY = process.argv.includes("--apply");

function planFor(doc) {
  const trialStartDate = doc.createdAt || new Date();
  const trialEndDate = computeTrialEndDate(trialStartDate);
  const trialActive = Date.now() < trialEndDate.getTime();

  const hasRealSubscription = !!doc.subscriptionEndDate;

  const update = {
    trialStartDate,
    trialEndDate,
  };

  if (hasRealSubscription) {
    // Bookkeeping only — real subscription already governs access.
    update.isTrialActive = false;
    update.paymentRequired = false;
  } else {
    update.isTrialActive = trialActive;
    update.paymentRequired = !trialActive;
    if (!trialActive && doc.accountStatus === "active") {
      update.accountStatus = "pending_payment";
    }
  }

  return update;
}

async function migrateModel(Model, label) {
  const docs = await Model.find({ trialStartDate: { $exists: false } }).select(
    "createdAt accountStatus subscriptionEndDate",
  );

  console.log(`\n${label}: ${docs.length} doc(s) missing trialStartDate`);

  let willGate = 0;
  for (const doc of docs) {
    const update = planFor(doc);
    if (update.accountStatus === "pending_payment") willGate += 1;

    console.log(
      `  ${doc._id} createdAt=${doc.createdAt?.toISOString()} ` +
        `trialEndDate=${update.trialEndDate.toISOString()} ` +
        `paymentRequired=${update.paymentRequired} ` +
        (update.accountStatus ? `accountStatus->${update.accountStatus}` : "accountStatus unchanged"),
    );

    if (APPLY) {
      await Model.updateOne({ _id: doc._id }, { $set: update });
    }
  }

  console.log(
    `${label}: ${willGate} account(s) will be moved to pending_payment (trial already lapsed, never paid).`,
  );
}

async function migrate() {
  const mongoUri =
    process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI (or MONGODB_URI/DB_URI) not set in .env");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");
  console.log(APPLY ? "Mode: APPLY (writing changes)" : "Mode: DRY RUN (pass --apply to write)");

  await migrateModel(User, "User");
  await migrateModel(Purchaser, "Purchaser");

  await mongoose.disconnect();
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
