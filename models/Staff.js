const mongoose = require("mongoose");

const StaffSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    image: { type: String, trim: true },
    aadharCard: { type: String, trim: true },
    // Store Cloudinary public IDs so we can delete images from Cloudinary if needed
    imagePublicId: { type: String, trim: true },
    aadharPublicId: { type: String, trim: true },
    password: { type: String }, // For staff login
    approved: { type: Boolean, default: true }, // Kept for backward compatibility
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "approved",
    },
    workForType: {
      type: String,
      enum: ["stockist", "medical"],
      required: true,
    },
    workForId: { type: mongoose.Schema.Types.ObjectId },
    workForName: { type: String, trim: true, required: true },
    approvedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId },
    declinedAt: { type: Date },
    declinedBy: { type: mongoose.Schema.Types.ObjectId },
    currentWorkingPlace: { type: String, trim: true },
    isFresher: { type: Boolean, default: false },
    stockist: { type: mongoose.Schema.Types.ObjectId, ref: "Stockist" },
  },
  { timestamps: true }
);

StaffSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.aadharCard;       
    delete ret.address;          
    delete ret.imagePublicId;     
    delete ret.aadharPublicId;    
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model("Staff", StaffSchema);
