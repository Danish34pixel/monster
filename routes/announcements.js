const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const { authenticate, isAdmin } = require("../middleware/auth");

const isValidObjectId = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const normalizeAnnouncementRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "medical_owner" || normalized === "medicalowner") {
    return "user";
  }
  return normalized;
};

// GET /api/announcements — active announcements for the logged-in user's role
router.get("/", authenticate, async (req, res) => {
  try {
    const role = normalizeAnnouncementRole(req.user.role);
    const filter = { isActive: true };
    if (role !== "admin") {
      filter.targetRoles = { $in: [role] };
    }
    const announcements = await Announcement.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: announcements });
  } catch (err) {
    console.error("Announcements GET error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch announcements." });
  }
});

// GET /api/announcements/all — admin: all announcements
router.get("/all", authenticate, isAdmin, async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ success: true, data: announcements });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch announcements." });
  }
});

// GET /api/announcements/:id — fetch a single announcement if visible to the user
router.get("/:id", authenticate, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found.",
      });
    }

    const announcement = await Announcement.findById(req.params.id).lean();
    if (!announcement) {
      return res
        .status(404)
        .json({ success: false, message: "Announcement not found." });
    }

    if (req.user.role !== "admin") {
      const viewerRole = normalizeAnnouncementRole(req.user.role);
      const targetRoles = Array.isArray(announcement.targetRoles)
        ? announcement.targetRoles
        : [];
      if (!announcement.isActive || !targetRoles.includes(viewerRole)) {
        return res.status(403).json({
          success: false,
          message: "Access denied.",
        });
      }
    }

    return res.json({ success: true, data: announcement });
  } catch (err) {
    console.error("Announcement detail error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch announcement." });
  }
});

// POST /api/announcements — admin: create
router.post("/", authenticate, isAdmin, async (req, res) => {
  try {
    const { title, message, targetRoles } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: "Title is required." });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }
    const roles = Array.isArray(targetRoles) && targetRoles.length > 0
      ? targetRoles
      : ["user", "purchaser", "stockist"];

    const announcement = await Announcement.create({
      title: String(title).trim(),
      message: String(message).trim(),
      targetRoles: roles,
      isActive: true,
      createdBy: req.user._id,
    });
    return res.status(201).json({ success: true, data: announcement });
  } catch (err) {
    console.error("Announcement create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create announcement." });
  }
});

// POST /api/announcements/:id/read — mark read by current user
router.post("/:id/read", authenticate, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Not found." });
    }
    await Announcement.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: req.user._id },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to mark as read." });
  }
});

// PATCH /api/announcements/:id — admin: toggle active or edit
router.patch("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Not found." });
    }
    const { isActive, title, message } = req.body || {};
    const update = {};
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (title) update.title = String(title).trim();
    if (message) update.message = String(message).trim();
    const doc = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to update." });
  }
});

// DELETE /api/announcements/:id — admin: delete
router.delete("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Not found." });
    }
    await Announcement.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete." });
  }
});

module.exports = router;
