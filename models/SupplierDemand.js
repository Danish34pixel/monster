const mongoose = require("mongoose");

const SupplierDemandItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const SupplierDemandSchema = new mongoose.Schema(
  {
    stockistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stockist",
      required: true,
      index: true,
    },
    items: {
      type: [SupplierDemandItemSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one item is required",
      },
    },
    status: {
      type: String,
      enum: ["pending", "sent", "accepted", "dispatched", "completed", "rejected"],
      default: "pending",
      index: true,
    },
    originalDemandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Demand",
      required: true,
      index: true,
    },
    sentAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { strict: true, timestamps: true }
);

SupplierDemandSchema.index({ stockistId: 1, status: 1, createdAt: -1 });
SupplierDemandSchema.index({ originalDemandId: 1, stockistId: 1 }, { unique: true });

module.exports = mongoose.model("SupplierDemand", SupplierDemandSchema);

