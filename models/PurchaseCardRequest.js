const mongoose = require("mongoose");

const PurchaseCardRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stockists: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Stockist", required: true },
    ],
    approvals: [
      {
        stockist: { type: mongoose.Schema.Types.ObjectId, ref: "Stockist" },
        approvedAt: Date,
      },
    ],
    // Display info for the requester (purchaser) when requests are created on their behalf
    requesterDisplay: {
      name: String,
      email: String,
      purchaserId: { type: mongoose.Schema.Types.ObjectId, ref: "Purchaser" },
    },
    // Per-stockist one-click approval tokens (for email links)
    approvalTokens: [
      {
        stockist: { type: mongoose.Schema.Types.ObjectId, ref: "Stockist" },
        token: { type: String },
        used: { type: Boolean, default: false },
      },
    ],
    status: {
      type: String,
      enum: ["pending", "approved", "cancelled"],
      default: "pending",
    },
    approvedAt: Date,
  },
  { timestamps: true }
);
PurchaseCardRequestSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.approvalTokens;
    delete ret.__v;
    return ret;
  },
})
module.exports = mongoose.model(
  "PurchaseCardRequest",
  PurchaseCardRequestSchema
);
