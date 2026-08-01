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
    approved: { type: Boolean, default: true },
    verified: { type: Boolean, default: true },
    purchasingCardRequested: { type: Boolean, default: false },
    // Payment & subscription flow
    accountStatus: {
      type: String,
      enum: ["pending_payment", "pending_admin_verification", "active", "rejected"],
      default: "active",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "failed"],
      default: "paid",
    },
    razorpayOrderId: { type: String, trim: true },
    razorpayPaymentId: { type: String, trim: true },
    planAmount: { type: Number },
    paidAt: { type: Date, default: null },
    subscriptionPlan: { type: String, enum: ["monthly", "quarterly", "yearly", null], default: null },
    pendingPlanKey: { type: String, trim: true },
    subscriptionStartDate: { type: Date, default: null },
    subscriptionEndDate: { type: Date, default: null },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: {
      type: require("mongoose").Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // 90-day free trial (set at signup; no payment required until it lapses)
    trialStartDate: { type: Date },
    trialEndDate: { type: Date },
    isTrialActive: { type: Boolean, default: false },
    paymentRequired: { type: Boolean, default: false },
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
