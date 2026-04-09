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
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    active: { type: Boolean, default: true },
  },
  { strict: true, timestamps: true }
);

module.exports = mongoose.model("Medicine", MedicineSchema);
