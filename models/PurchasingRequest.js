const mongoose = require("mongoose");

const PurchasingRequestSchema = new mongoose.Schema(
  {
    requester: {
      // partial user info stored at request time
      fullName: String,
      email: String,
      tempData: Object,
    },
    stockistIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Stockist" }],
    approvals: [
      {
        stockistId: { type: mongoose.Schema.Types.ObjectId, ref: "Stockist" },
        approvedAt: Date,
      },
    ],
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    purchaserData: Object, // data to save when approved
  },
  { timestamps: true }
);
PurchasingRequestSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.requester?.tempData;
    delete ret.purchaserData;
    return ret;
  },
});
module.exports = mongoose.model("PurchasingRequest", PurchasingRequestSchema);
