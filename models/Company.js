const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 120,
    },
    description: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, default: true },
    stockists: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Stockist" }],
      default: [],
    },
    stockistNames: { type: [String], default: [] },
    stockistName: { type: String, trim: true }, // Added singular for convenience
  },
  { strict: true, timestamps: true },
);

module.exports = mongoose.model("Company", CompanySchema);
