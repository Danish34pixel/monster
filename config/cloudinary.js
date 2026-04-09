const cloudinary = require("cloudinary").v2;
const path = require("path");
const crypto = require("crypto");

// Detect whether Cloudinary is configured. If not, we provide a safe
// fallback so server-side signup flows don't hard-fail in environments
// where Cloudinary credentials were not provided (for example, a quick
// deploy without env vars). In production it's preferable to configure
// Cloudinary properly; this fallback only avoids a 500 that masks the
// real problem in logs.
const CLOUDINARY_CONFIGURED = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (CLOUDINARY_CONFIGURED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn(
    "Cloudinary not configured: CLOUDINARY_CLOUD_NAME/API_KEY/SECRET missing. Using local-file fallback for uploads."
  );
}

// Upload image to Cloudinary or fallback to local path when Cloudinary is
// not configured. The function always returns an object with `url` and
// `public_id` (public_id may be null for fallback) to keep callers simple.
const uploadToCloudinary = async (file, folder = "medtek") => {
  if (!file || !file.path) {
    throw new Error("No file provided for upload");
  }

  if (!CLOUDINARY_CONFIGURED) {
    // Return a file:// style URL to the uploaded local file so the rest of
    // the code can continue. Note: in production you should serve uploads
    // from a persistent store or configure Cloudinary.
    return { url: `file://${file.path}`, public_id: null };
  }
  const fileExt = path.extname(file.originalname);
  const publicId = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      public_id: publicId, // let Cloudinary generate ID
      folder: folder,
      resource_type: "auto",
      transformation: [{ quality: "auto:good" }, { fetch_format: "auto" }],
    });

    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw new Error(`Cloudinary upload failed: ${error && error.message}`);
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
