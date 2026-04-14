const mongoose = require("mongoose");

const SupplierDemandItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const SupplierDemandSchema = new mongoose.Schema(
  {
    supplierId: {
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
      enum: ["pending", "accepted", "rejected", "fulfilled"],
      default: "pending",
      index: true,
    },
    originalDemandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Demand",
      required: true,
      index: true,
    },
  },
  { strict: true, timestamps: true }
);

SupplierDemandSchema.index({ supplierId: 1, status: 1, createdAt: -1 });
SupplierDemandSchema.index({ originalDemandId: 1, supplierId: 1 }, { unique: true });

module.exports = mongoose.model("SupplierDemand", SupplierDemandSchema);

