const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");

const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Detect whether Cloudinary is configured. If not, we provide a safe
// fallback so server-side signup flows don't hard-fail in environments
// where Cloudinary credentials were not provided (for example, a quick
// deploy without env vars). In production it's preferable to configure
// Cloudinary properly; this fallback only avoids a 500 that masks the
// real problem in logs.
const CLOUDINARY_CONFIGURED = Boolean(
  process.env.CLOUDINARY_DISABLED !== "1" &&
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET,
);

if (CLOUDINARY_CONFIGURED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn(
    "Cloudinary not configured: CLOUDINARY_CLOUD_NAME/API_KEY/SECRET missing.",
  );
}

// Upload image to Cloudinary and require a secure URL. This helper must not
// silently fall back to a local upload path.
const uploadToCloudinary = async (file, folder = "medtek") => {
  if (!file || !file.path) {
    throw new Error("No file provided for upload");
  }

  console.log(`[Cloudinary] uploadToCloudinary invoked`, {
    folder,
    filePath: file.path,
    originalname: file.originalname,
    mimetype: file.mimetype,
  });

  if (!CLOUDINARY_CONFIGURED) {
    const errorMessage =
      "Cloudinary is not configured. Missing CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.";
    console.error(`[Cloudinary] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  const fileExt = path.extname(file.originalname || "");
  const publicId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${fileExt}`;

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      public_id: publicId,
      folder,
      resource_type: "auto",
      transformation: [{ quality: "auto:good" }, { fetch_format: "auto" }],
    });

    console.log(`[Cloudinary] upload result`, {
      secure_url: result && result.secure_url,
      public_id: result && result.public_id,
      folder,
    });

    if (!result || !result.secure_url) {
      const errorMessage =
        "Cloudinary upload succeeded but secure_url was missing.";
      console.error(`[Cloudinary] ${errorMessage}`, result);
      throw new Error(errorMessage);
    }

    return {
      secure_url: result.secure_url,
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    const errorMessage = `Cloudinary upload failed: ${error && error.message}`;
    console.error(`[Cloudinary] ${errorMessage}`);
    throw new Error(errorMessage);
  }
};

// Delete image from Cloudinary (no-op if not configured)
const deleteFromCloudinary = async (public_id) => {
  if (!CLOUDINARY_CONFIGURED) return false;
  try {
    await cloudinary.uploader.destroy(public_id);
    return true;
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error && error.message);
    return false;
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  cloudinary,
  CLOUDINARY_CONFIGURED,
};
