const mongoose = require("mongoose");

// Lenient schema to avoid breaking if existing documents have different shapes.
// We add common fields while keeping strict: false so older documents remain valid.
const StockistSchema = new mongoose.Schema(
  {
    name: { type: String },
    contactPerson: { type: String },
    phone: { type: String },
    email: { type: String },
    password: { type: String },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
    },
    licenseNumber: String,
    licenseExpiry: Date,
    licenseImageUrl: { type: String },
    // New fields
    dob: Date,
    bloodGroup: String,
    profileImageUrl: { type: String },
    roleType: String, // 'Proprietor' or 'Pharmacist'
    cntxNumber: String,
    // Approval metadata (set by admin)
    approved: { type: Boolean, default: false },
    declined: { type: Boolean, default: false },
    declinedAt: Date,
    // Processing status: 'processing' -> waiting for admin review
    // 'approved' -> admin approved
    // 'declined' -> admin declined
    status: {
      type: String,
      enum: ["processing", "approved", "declined"],
      default: "processing",
    },
    approvedAt: Date,
    approvedBy: { type: String },
  },
  { strict: false, timestamps: true }
);

StockistSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.phone;
    delete ret.address;
    delete ret.licenseImageUrl;
    delete ret.profileImageUrl;
    return ret;
  },
});

module.exports = mongoose.model("Stockist", StockistSchema);
