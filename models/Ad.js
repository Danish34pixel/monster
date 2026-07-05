const mongoose = require("mongoose");

const AdSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    stockistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stockist",
      required: true,
      index: true,
    },
    stockistName: { type: String, trim: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    mediaUrl: { type: String, required: true },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, default: null },
    clickCount: { type: Number, default: 0 },
    impressionCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ad", AdSchema);
