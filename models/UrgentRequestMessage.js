const mongoose = require("mongoose");

const UrgentRequestMessageSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UrgentRequest",
      required: true,
      index: true,
    },
    senderRole: { type: String, enum: ["user", "purchaser"], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderName: { type: String, trim: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    deliveredAt: { type: Date, default: null },
    readBy: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  },
  { timestamps: true }
);

// Compound index: fast sorted fetch of all messages for a request
UrgentRequestMessageSchema.index({ requestId: 1, createdAt: 1 });

module.exports = mongoose.model("UrgentRequestMessage", UrgentRequestMessageSchema);
