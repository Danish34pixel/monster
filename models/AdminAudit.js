const mongoose = require("mongoose");

const adminAuditSchema = new mongoose.Schema(
  {
    actor: {
      // id of the admin who performed the action
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actorEmail: { type: String },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    action: {
      type: String,
      enum: ["approve", "decline", "suspend", "reactivate"],
      required: true,
    },
    note: { type: String,
      trim: true,
      maxlength: [500, "Note cannot exceed 500 characters"],
     },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true }
);
AdminAuditSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.__v; 
    delete ret.ip;
    delete ret.userAgent; 
    return ret;
  },
});
module.exports = mongoose.model("AdminAudit", adminAuditSchema);
