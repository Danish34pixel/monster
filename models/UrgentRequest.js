const mongoose = require("mongoose");

const UrgentRequestItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    description: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false }
);

const UrgentRequestSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdByName: { type: String, trim: true },
    // Array of items — replaces flat itemName/quantity/urgencyNote fields.
    // Old documents (flat fields) are handled by normalizeItems() in routes.
    items: {
      type: [UrgentRequestItemSchema],
      default: undefined,
    },
    // Top-level note applying to the whole request (e.g. "patient in ICU").
    // Separate from per-item description.
    urgencyNote: { type: String, trim: true, maxlength: 500, default: null },
    status: {
      type: String,
      enum: ["pending", "accepted", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchaser",
      default: null,
      index: true,
    },
    acceptedByName: { type: String, default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UrgentRequest", UrgentRequestSchema);
