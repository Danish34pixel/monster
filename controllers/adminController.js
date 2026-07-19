const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const EventLog = require("../models/EventLog");
const { logEvent } = require("../utils/eventLog");

// GET /api/admin/pending-users/count — lightweight badge endpoint
exports.pendingCount = async (req, res) => {
  try {
    const query = { paymentStatus: "paid", accountStatus: "pending_admin_verification" };
    const [users, purchasers] = await Promise.all([
      User.countDocuments(query),
      Purchaser.countDocuments(query),
    ]);
    return res.json({ success: true, count: users + purchasers });
  } catch (err) {
    return res.status(500).json({ success: false, count: 0 });
  }
};

// GET /api/admin/pending-users
// Users/purchasers who paid and need admin verification
exports.pendingUsers = async (req, res) => {
  try {
    const [users, purchasers] = await Promise.all([
      User.find({ paymentStatus: "paid", accountStatus: "pending_admin_verification" })
        .select("medicalName ownerName email role paymentStatus accountStatus razorpayOrderId razorpayPaymentId planAmount paidAt subscriptionPlan subscriptionStartDate subscriptionEndDate createdAt")
        .lean(),
      Purchaser.find({ paymentStatus: "paid", accountStatus: "pending_admin_verification" })
        .select("fullName email paymentStatus accountStatus razorpayOrderId razorpayPaymentId planAmount paidAt subscriptionPlan subscriptionStartDate subscriptionEndDate createdAt")
        .lean(),
    ]);

    const combined = [
      ...users.map((u) => ({ ...u, _userModel: "User", role: u.role || "medical_owner" })),
      ...purchasers.map((p) => ({ ...p, _userModel: "Purchaser", role: "purchaser" })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return res.json({ success: true, data: combined, total: combined.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch pending users" });
  }
};

// POST /api/admin/verify-user/:id?model=User|Purchaser
exports.verifyUser = async (req, res) => {
  try {
    const { id } = req.params;
    const model = req.query.model || req.body.model || "User";
    const Collection = model === "Purchaser" ? Purchaser : User;

    const doc = await Collection.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "User not found" });
    if (doc.paymentStatus !== "paid") {
      return res.status(400).json({ success: false, message: "Payment not confirmed for this user" });
    }

    doc.accountStatus = "active";
    doc.approved = true;
    doc.verifiedAt = new Date();
    doc.verifiedBy = req.user._id;
    await doc.save();

    logEvent(doc._id, model, "admin_verified", {
      adminId: req.user._id,
      adminEmail: req.user.email,
    });

    return res.json({ success: true, message: "User verified and activated", verifiedAt: doc.verifiedAt });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to verify user" });
  }
};

// POST /api/admin/reject-user/:id?model=User|Purchaser
exports.rejectUser = async (req, res) => {
  try {
    const { id } = req.params;
    const model = req.query.model || req.body.model || "User";
    const Collection = model === "Purchaser" ? Purchaser : User;

    const doc = await Collection.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "User not found" });

    doc.accountStatus = "rejected";
    doc.declined = true;
    await doc.save();

    logEvent(doc._id, model, "admin_rejected", {
      adminId: req.user._id,
      adminEmail: req.user.email,
      reason: req.body.reason,
    });

    return res.json({ success: true, message: "User rejected" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to reject user" });
  }
};

// GET /api/admin/users/:id/timeline
exports.userTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const events = await EventLog.find({ userId: id })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ success: true, data: events });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch timeline" });
  }
};
