const mongoose = require("mongoose");

const DemandMessageSchema = new mongoose.Schema(
  {
    supplierDemandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierDemand",
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ["medical_owner", "stockist", "system"],
      required: true,
    },
    // System messages (e.g. "Order accepted") have no human sender.
    senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, trim: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    deliveredAt: { type: Date, default: null },
    readBy: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  },
  { timestamps: true }
);

// Compound index: fast sorted fetch of all messages for a supplier demand
DemandMessageSchema.index({ supplierDemandId: 1, createdAt: 1 });

module.exports = mongoose.model("DemandMessage", DemandMessageSchema);
