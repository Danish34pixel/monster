const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const Ad = require("../models/Ad");
const Stockist = require("../models/Stockist");
const { uploadToCloudinary } = require("../config/cloudinary");
let fileTypeModulePromise;

async function detectFileType(filePath) {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import("file-type");
  }
  const mod = await fileTypeModulePromise;
  return mod.fileTypeFromFile(filePath);
}

const ALLOWED_AD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const ALLOWED_AD_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".mov",
]);
const {
  authenticate,
  optionalAuthenticate,
  isAdmin,
} = require("../middleware/auth");
const { adUpload, handleUploadError } = require("../middleware/upload");

const getPublicBaseUrl = (req) => {
  const configured = String(process.env.BACKEND_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const isLocalHost = (value) =>
    /^https?:\/\/(?:localhost|127\.0\.0\.1|::1)(?::\d+)?(?:\/|$)/i.test(
      value,
    ) || /^(?:localhost|127\.0\.0\.1|::1)(?::\d+)?(?:\/|$)/i.test(value);

  if (configured && !isLocalHost(configured)) {
    if (/^https?:\/\//i.test(configured)) return configured;
    return `https://${configured}`;
  }

  const host = req.get("host");
  if (!host) return "";
  return `${req.protocol}://${host}`;
};

const normalizeStoredMediaPath = (mediaUrl) => {
  if (!mediaUrl) return mediaUrl;

  const raw = String(mediaUrl).trim();
  const pathname = (() => {
    try {
      return new URL(raw, "http://local.invalid").pathname;
    } catch {
      return raw;
    }
  })();

  const clean = pathname.split("?")[0].split("#")[0];
  if (clean.startsWith("/uploads/")) return clean;
  if (clean.startsWith("uploads/")) return `/${clean}`;

  const filename = path.posix.basename(clean);
  return filename ? `/uploads/${filename}` : clean;
};

const toAbsoluteMediaUrl = (req, mediaUrl) => {
  if (!mediaUrl) return mediaUrl;
  const isLocalHost = (value) =>
    /^https?:\/\/(?:localhost|127\.0\.0\.1|::1)(?::\d+)?(?:\/|$)/i.test(value);

  if (/^https?:\/\//i.test(mediaUrl)) {
    if (!isLocalHost(mediaUrl)) {
      return mediaUrl;
    }

    const base = getPublicBaseUrl(req);
    if (!base) return mediaUrl;

    try {
      const parsed = new URL(mediaUrl);
      return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return mediaUrl;
    }
  }

  const base = getPublicBaseUrl(req);
  if (!base) return mediaUrl;
  return `${base}${normalizeStoredMediaPath(mediaUrl)}`;
};

const mapAdMediaUrls = (req, ad) => ({
  ...ad,
  mediaUrl: toAbsoluteMediaUrl(req, ad?.mediaUrl),
});

const deleteLocalTempFile = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
    console.log(`[Ads] Deleted temp file: ${filePath}`);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.log(`[Ads] Temp file already removed: ${filePath}`);
      return;
    }
    console.error(`[Ads] Failed to delete temp file: ${filePath}`, error);
    throw error;
  }
};

const validateAdUploadFile = async (file) => {
  if (!file) {
    throw new Error("Missing image");
  }

  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ALLOWED_AD_EXTENSIONS.has(ext)) {
    throw new Error("Invalid image");
  }

  const detected = await detectFileType(file.path);
  const detectedMime = detected && detected.mime;
  if (!detectedMime || !ALLOWED_AD_MIME_TYPES.has(detectedMime)) {
    throw new Error("Invalid image");
  }
};

// GET /api/ads/active — public feed for the app; auth is optional so deployed
// pages can still show ads even before a user logs in.
router.get("/active", optionalAuthenticate, async (req, res) => {
  try {
    const now = new Date();
    const ads = await Ad.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    return res.json({
      success: true,
      data: ads.map((ad) => mapAdMediaUrls(req, ad)),
    });
  } catch (err) {
    console.error("Ads active error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch ads." });
  }
});

// GET /api/ads — admin: all ads (including inactive)
router.get("/", authenticate, isAdmin, async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 }).lean();
    return res.json({
      success: true,
      data: ads.map((ad) => mapAdMediaUrls(req, ad)),
    });
  } catch (err) {
    console.error("Ads list error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch ads." });
  }
});

// POST /api/ads — admin: upload and create new ad
router.post(
  "/",
  authenticate,
  isAdmin,
  (req, res, next) =>
    adUpload.single("media")(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    }),
  async (req, res) => {
    try {
      if (!req.file) {
        console.error("[Ads] Missing image upload");
        return res
          .status(400)
          .json({ success: false, message: "Media file is required." });
      }

      console.log("[Ads] Incoming file:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        fieldname: req.file.fieldname,
      });
      console.log("[Ads] Local temp path:", req.file.path);

      const { title, stockistId, expiresAt } = req.body || {};
      if (!title || !String(title).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Title is required." });
      }
      if (!stockistId) {
        return res
          .status(400)
          .json({ success: false, message: "Stockist is required." });
      }

      const stockist = await Stockist.findById(stockistId)
        .select("name contactPerson")
        .lean();
      if (!stockist) {
        return res
          .status(404)
          .json({ success: false, message: "Stockist not found." });
      }

      await validateAdUploadFile(req.file);

      const ext = path.extname(req.file.originalname || "").toLowerCase();
      const mime = (req.file.mimetype || "").toLowerCase();
      const mediaType =
        mime.startsWith("video/") || [".mp4", ".mov"].includes(ext)
          ? "video"
          : "image";

      const cloudinaryResponse = await uploadToCloudinary(req.file, "ads");
      console.log("[Ads] Cloudinary upload result:", cloudinaryResponse);
      const mediaUrl =
        cloudinaryResponse?.secure_url || cloudinaryResponse?.url;
      console.log("[Ads] secure_url:", mediaUrl);

      if (!mediaUrl) {
        throw new Error("Cloudinary upload did not return a secure URL");
      }

      await deleteLocalTempFile(req.file.path);

      const adPayload = {
        title: String(title).trim(),
        stockistId,
        stockistName: stockist.name || stockist.contactPerson || "",
        mediaType,
        mediaUrl,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: req.user._id,
      };
      console.log("[Ads] MongoDB object before save:", adPayload);

      const ad = await Ad.create(adPayload);
      return res
        .status(201)
        .json({ success: true, data: mapAdMediaUrls(req, ad.toObject()) });
    } catch (err) {
      if (req.file?.path) {
        try {
          await deleteLocalTempFile(req.file.path);
        } catch (cleanupError) {
          console.error(
            "[Ads] Failed deletion of temporary file after error:",
            cleanupError,
          );
        }
      }
      console.error("[Ads] create error:", err);
      if (
        err &&
        err.message &&
        err.message.includes("Cloudinary upload failed")
      ) {
        return res
          .status(500)
          .json({
            success: false,
            message: "Image upload to Cloudinary failed.",
          });
      }
      if (err && err.message && err.message.includes("Missing image")) {
        return res
          .status(400)
          .json({ success: false, message: "Media file is required." });
      }
      if (err && err.message && err.message.includes("Invalid image")) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid image file." });
      }
      if (err && err.message && err.message.includes("secure URL")) {
        return res
          .status(500)
          .json({
            success: false,
            message: "Cloudinary did not return a valid secure URL.",
          });
      }
      return res
        .status(500)
        .json({ success: false, message: "Failed to create ad." });
    }
  },
);

// POST /api/ads/:id/click — record a click if the request is authenticated,
// but allow anonymous clients to avoid dropping analytics on public pages.
router.post("/:id/click", optionalAuthenticate, async (req, res) => {
  try {
    await Ad.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to record click." });
  }
});

// POST /api/ads/:id/impression — allow anonymous impressions for public pages.
router.post("/:id/impression", optionalAuthenticate, async (req, res) => {
  try {
    await Ad.findByIdAndUpdate(req.params.id, { $inc: { impressionCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to record impression." });
  }
});

// PATCH /api/ads/:id — admin: toggle active or update title/expiry
router.patch("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const { isActive, title, expiresAt } = req.body || {};
    const update = {};
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (title) update.title = String(title).trim();
    if (expiresAt !== undefined)
      update.expiresAt = expiresAt ? new Date(expiresAt) : null;
    const ad = await Ad.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true },
    );
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found." });
    return res.json({
      success: true,
      data: mapAdMediaUrls(req, ad.toObject()),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to update ad." });
  }
});

// DELETE /api/ads/:id — admin: delete ad
router.delete("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const ad = await Ad.findByIdAndDelete(req.params.id);
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found." });
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete ad." });
  }
});

module.exports = router;
