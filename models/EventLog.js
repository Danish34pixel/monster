const mongoose = require("mongoose");

const eventLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userModel: { type: String, enum: ["User", "Purchaser"], required: true },
    eventType: {
      type: String,
      enum: [
        "signup_submitted",
        "payment_initiated",
        "payment_success",
        "payment_failed",
        "payment_verified_signature",
        "payment_verified_webhook",
        "admin_verified",
        "admin_rejected",
        "login_success",
        "login_blocked",
      ],
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

eventLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("EventLog", eventLogSchema);
