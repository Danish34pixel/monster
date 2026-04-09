const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema(
  {},
  { strict: false, timestamps: true }
);

module.exports = mongoose.model("Medicine", MedicineSchema);
