const User = require("../models/User");
const AdminAudit = require("../models/AdminAudit");

const SAFE_USER_FIELDS =
  "medicalName ownerName email role approved declined isVerified hasPurchasingCard purchasingCardRequested approvedAt createdAt updatedAt";

exports.list = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const q = {};

    if (status === "approved") {
      q.$or = [{ approved: true }, { isVerified: true }];
    } else if (status === "declined") {
      q.declined = true;
    } else if (status === "processing") {
      q.$and = [
        { approved: { $ne: true } },
        { isVerified: { $ne: true } },
        { declined: { $ne: true } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [items, total] = await Promise.all([
      User.find(q)
        .select(SAFE_USER_FIELDS)
        .skip((pageNum - 1) * perPage)
        .limit(perPage)
        .lean(),
      User.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: items,
      meta: { total, page: pageNum, limit: perPage },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to list users" });
  }
};

exports.get = async (req, res) => {
  try {
    const u = await User.findById(req.params.id).select(SAFE_USER_FIELDS).lean();
    if (!u) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({ success: true, data: u });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch user" });
  }
};

exports.approve = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    u.approved = true;
    u.isVerified = true;
    u.declined = false;
    u.approvedAt = new Date();
    await u.save();

    await AdminAudit.create({
      actor: req.user && req.user._id,
      actorEmail: req.user && req.user.email,
      targetUser: u._id,
      action: "approve",
      ip: req.ip,
      userAgent: req.get("User-Agent") || null,
    });

    return res.json({ success: true, data: { approvedAt: u.approvedAt } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to approve user" });
  }
};

exports.decline = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    u.declined = true;
    u.approved = false;
    u.isVerified = false;
    await u.save();

    await AdminAudit.create({
      actor: req.user && req.user._id,
      actorEmail: req.user && req.user.email,
      targetUser: u._id,
      action: "decline",
      ip: req.ip,
      userAgent: req.get("User-Agent") || null,
    });

    return res.json({ success: true, data: {} });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to decline user" });
  }
};
