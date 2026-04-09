const mongoose = require("mongoose");

const PurchaserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    contactNo: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: false,
    },
    password: {
      type: String,
      required: false,
      select: false,
    },
    aadharImage: {
      type: String, // Cloudinary URL
      required: true,
    },
    photo: {
      type: String, // Cloudinary URL
      required: true,
    },
    photoPublicId: {
      type: String, // store for easy deletion later
      trim: true,
    },
    approved: {
      type: Boolean,
      default: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    // reference to the user/stockist who created this purchaser
    createdBy: {
      type: require("mongoose").Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);
PurchaserSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.address;
    delete ret.contactNo;
    delete ret.email;
    delete ret.__v;
    return ret;
  },
});
module.exports = mongoose.model("Purchaser", PurchaserSchema);
