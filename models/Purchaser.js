const mongoose = require("mongoose");

const PurchaserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, required: true, trim: true, maxlength: 200 },
    contactNo: { type: String, required: true, trim: true, maxlength: 20 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: 120,
    },
    password: { type: String, required: false, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    aadharImage: { type: String, required: true },
    photo: { type: String, required: true },
    photoPublicId: { type: String, trim: true },
    approved: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    purchasingCardRequested: { type: Boolean, default: false },
    createdBy: {
      type: require("mongoose").Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { strict: true, timestamps: true }
);

PurchaserSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Purchaser", PurchaserSchema);
