const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
      maxlength: 120,
    },
    genericName: { type: String, trim: true, maxlength: 120 },
    manufacturer: { type: String, trim: true, maxlength: 120 },
    price: { type: Number, min: 0 },
    category: { type: String, trim: true, maxlength: 120 },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    companyName: { type: String, trim: true, maxlength: 120 },
    stockists: [{ type: mongoose.Schema.Types.ObjectId, ref: "Stockist" }],
    stockistNames: [{ type: String, trim: true, maxlength: 120 }],
    active: { type: Boolean, default: true },
  },
  { strict: true, timestamps: true },
);

module.exports = mongoose.model("Medicine", MedicineSchema);
