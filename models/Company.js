const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema(
  {},
  { strict: false, timestamps: true }
);

module.exports = mongoose.model("Company", CompanySchema);
