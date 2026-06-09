const mongoose = require("mongoose");

const StockistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactPerson: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      maxlength: 120,
    },
    password: { type: String, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    address: {
      street: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 120 },
      state: { type: String, trim: true, maxlength: 120 },
      pincode: { type: String, trim: true, maxlength: 12 },
    },
    licenseNumber: { type: String, trim: true, maxlength: 60 },
    licenseExpiry: { type: Date },
    licenseImageUrl: { type: String, trim: true },
    dob: { type: Date },
    bloodGroup: { type: String, trim: true, maxlength: 5 },
    // List of medicine names this stockist carries in inventory
    medicines: [{ type: String, trim: true }],
    availableItems: [
      {
        name: { type: String, trim: true },
      },
    ],
    profileImageUrl: { type: String, trim: true },
    roleType: { type: String, trim: true, maxlength: 40 },
    cntxNumber: { type: String, trim: true, maxlength: 40 },
    approved: { type: Boolean, default: true },
    declined: { type: Boolean, default: false },
    declinedAt: Date,
    status: {
      type: String,
      enum: ["processing", "approved", "declined"],
      default: "approved",
    },
    approvedAt: { type: Date, default: Date.now },
    approvedBy: { type: String, trim: true, default: "system" },
    companies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Company" }],
    companyNames: [{ type: String, trim: true }],
  },
  { strict: true, timestamps: true }
);

StockistSchema.pre("save", function (next) {
  this.approved = true;
  this.status = "approved";
  this.declined = false;
  if (!this.approvedAt) this.approvedAt = new Date();
  next();
});

StockistSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    return ret;
  },
});

module.exports = mongoose.model("Stockist", StockistSchema);
