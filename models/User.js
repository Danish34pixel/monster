const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    medicalName: {
      type: String,
      required: [true, "Medical store name is required"],
      trim: true,
      maxlength: [100, "Medical store name cannot exceed 100 characters"],
    },
    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
      maxlength: [50, "Owner name cannot exceed 50 characters"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [200, "Address cannot exceed 200 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    contactNo: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
      match: [/^[0-9+\-\s()]+$/, "Please enter a valid contact number"],
    },
    drugLicenseNo: {
      type: String,
      required: [true, "Drug license number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    drugLicenseImage: {
      type: String,
      required: [true, "Drug license image is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
    },
    // Fields used for password reset flow
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    // Whether the user has been granted a purchasing card (can manage purchasers)
    hasPurchasingCard: {
      type: Boolean,
      default: false,
    },
    // When a user requests a purchasing card this flag will be set so admins can review
    purchasingCardRequested: {
      type: Boolean,
      default: false,
    },
    // Admin approval flags for user accounts
    approved: {
      type: Boolean,
      default: false,
    },
    declined: {
      type: Boolean,
      default: false,
    },
    approvedAt: {
      type: Date,
    },
    // Optional purchaser-specific fields for self-signup flows
    aadharNo: {
      type: String,
      trim: true,
    },
    aadharImage: {
      type: String,
    },
    personalPhoto: {
      type: String,
    },
    role: {
      type: String,
      // allow 'stockist' role so stockist accounts can be represented and granted rights
      enum: ["user", "admin", "stockist"],
      default: "user",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.address;
    delete ret.personalPhoto;
    delete ret.aadharImage;
    delete ret.aadharNo;
    delete ret.drugLicenseImage;
    delete ret.drugLicenseNo;
    delete ret.contactNo;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    return ret;
  },
})
// Note: `unique: true` is declared on `email` and `drugLicenseNo` above which
// creates the necessary unique indexes. Avoid declaring duplicate indexes
// with `schema.index()` to prevent Mongoose duplicate-index warnings.

module.exports = mongoose.model("User", userSchema);
