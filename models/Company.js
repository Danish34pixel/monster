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
    stockists: [{ type: mongoose.Schema.Types.ObjectId, ref: "Stockist" }],
    stockistNames: [{ type: String, trim: true, maxlength: 120 }],
  },
  { strict: true, timestamps: true },
);

module.exports = mongoose.model("Company", CompanySchema);
