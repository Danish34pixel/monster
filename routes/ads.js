const express = require("express");
const router = express.Router();
const path = require("path");
const Ad = require("../models/Ad");
const Stockist = require("../models/Stockist");
const { authenticate, isAdmin } = require("../middleware/auth");
const { adUpload, handleUploadError } = require("../middleware/upload");

// GET /api/ads/active — all authenticated users: active non-expired ads
router.get("/active", authenticate, async (req, res) => {
  try {
    const now = new Date();
    const ads = await Ad.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    return res.json({ success: true, data: ads });
  } catch (err) {
    console.error("Ads active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch ads." });
  }
});

// GET /api/ads — admin: all ads (including inactive)
router.get("/", authenticate, isAdmin, async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: ads });
  } catch (err) {
    console.error("Ads list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch ads." });
  }
});

// POST /api/ads — admin: upload and create new ad
router.post(
  "/",
  authenticate,
  isAdmin,
  (req, res, next) => adUpload.single("media")(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    next();
  }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Media file is required." });
      }
      const { title, stockistId, expiresAt } = req.body || {};
      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, message: "Title is required." });
      }
      if (!stockistId) {
        return res.status(400).json({ success: false, message: "Stockist is required." });
      }
      const stockist = await Stockist.findById(stockistId).select("name contactPerson").lean();
      if (!stockist) {
        return res.status(404).json({ success: false, message: "Stockist not found." });
      }
      const ext = path.extname(req.file.originalname || "").toLowerCase();
      const mime = (req.file.mimetype || "").toLowerCase();
      const mediaType =
        mime.startsWith("video/") || [".mp4", ".mov"].includes(ext)
          ? "video"
          : "image";
      const ad = await Ad.create({
        title: String(title).trim(),
        stockistId,
        stockistName: stockist.name || stockist.contactPerson || "",
        mediaType,
        mediaUrl: `/uploads/${req.file.filename}`,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: req.user._id,
      });
      return res.status(201).json({ success: true, data: ad });
    } catch (err) {
      console.error("Ads create error:", err);
      return res.status(500).json({ success: false, message: "Failed to create ad." });
    }
  }
);

// POST /api/ads/:id/click — any authenticated user: record a click
router.post("/:id/click", authenticate, async (req, res) => {
  try {
    await Ad.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to record click." });
  }
});

// POST /api/ads/:id/impression — any authenticated user: record impression
router.post("/:id/impression", authenticate, async (req, res) => {
  try {
    await Ad.findByIdAndUpdate(req.params.id, { $inc: { impressionCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to record impression." });
  }
});

// PATCH /api/ads/:id — admin: toggle active or update title/expiry
router.patch("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const { isActive, title, expiresAt } = req.body || {};
    const update = {};
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (title) update.title = String(title).trim();
    if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
    const ad = await Ad.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found." });
    return res.json({ success: true, data: ad });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to update ad." });
  }
});

// DELETE /api/ads/:id — admin: delete ad
router.delete("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const ad = await Ad.findByIdAndDelete(req.params.id);
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found." });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete ad." });
  }
});

module.exports = router;
