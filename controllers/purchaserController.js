// const Purchaser = require("../models/Purchaser");
// const { authenticate, isAdmin } = require("../middleware/auth");
// const fs = require("fs");
// const path = require("path");
// const { uploadToCloudinary } = require("../config/cloudinary");
// const bcrypt = require("bcryptjs");

// // Create purchaser with aadhar image and photo (Cloudinary URLs)
// exports.createPurchaser = async (req, res) => {
//   console.log("ENTER createPurchaser", { path: req.path, method: req.method });
//   try {
//     try {
//       console.log("Incoming files keys:", Object.keys(req.files || {}));
//     } catch (e) {}
//     // If authentication middleware attached a user, prefer it; otherwise allow anonymous creation
//     const creatorId = req.user && req.user._id;
//     const { fullName, address, contactNo, email } = req.body;
//     // Expecting two files: aadharImage and photo
//     if (!req.files || !req.files["aadharImage"] || !req.files["photo"]) {
//       return res.status(400).json({
//         success: false,
//         message: "Aadhar image and photo are required.",
//       });
//     }
//     // Upload the received files to Cloudinary and use secure URLs
//     const aadharFile = req.files["aadharImage"][0];
//     const photoFile = req.files["photo"][0];

//     let aadharUpload;
//     let photoUpload;
//     try {
//       aadharUpload = await uploadToCloudinary(
//         aadharFile,
//         "meditrap/purchasers"
//       );
//     } catch (uploadErr) {
//       console.warn(
//         "Aadhar upload failed, falling back to local file. Error:",
//         uploadErr && uploadErr.message
//       );
//       aadharUpload = {
//         url: aadharFile && aadharFile.path ? file://${aadharFile.path} : null,
//         public_id: null,
//       };
//     }

//     try {
//       photoUpload = await uploadToCloudinary(photoFile, "meditrap/purchasers");
//     } catch (uploadErr) {
//       console.warn(
//         "Photo upload failed, falling back to local file. Error:",
//         uploadErr && uploadErr.message
//       );
//       photoUpload = {
//         url: photoFile && photoFile.path ? file://${photoFile.path} : null,
//         public_id: null,
//       };
//     }

//     // If a password was provided, hash it before storing
//     let hashedPassword = undefined;
//     if (req.body && req.body.password) {
//       try {
//         const salt = await bcrypt.genSalt(10);
//         hashedPassword = await bcrypt.hash(String(req.body.password), salt);
//       } catch (e) {
//         console.warn("Password hashing failed:", e && e.message);
//       }
//     }

//     const purchaser = new Purchaser({
//       fullName,
//       address,
//       contactNo,
//       email,
//       password: hashedPassword,
//       aadharImage: aadharUpload.url,
//       photo: photoUpload.url,
//       createdBy: creatorId || undefined,
//     });
//     // Debug: log purchaser preview before save
//     try {
//       console.log("Saving purchaser:", {
//         fullName: purchaser.fullName,
//         addressLength: purchaser.address && purchaser.address.length,
//         contactNo: purchaser.contactNo,
//         email: purchaser.email,
//         aadharImage: Boolean(purchaser.aadharImage),
//         photo: Boolean(purchaser.photo),
//       });
//     } catch (e) {}

//     try {
//       await purchaser.save();
//     } catch (saveErr) {
//       console.error(
//         "Purchaser save error:",
//         saveErr && saveErr.stack ? saveErr.stack : saveErr
//       );
//       if (saveErr && saveErr.name === "ValidationError") {
//         return res.status(400).json({
//           success: false,
//           message: "Validation failed",
//           errors: Object.values(saveErr.errors || {}).map((e) => e.message),
//         });
//       }
//       // rethrow to outer catch which handles DEBUG_API
//       throw saveErr;
//     }
//     // Invalidate purchaser lists for this user and global list
//     // No cache invalidation here (purchaser caching removed) - keep DB-only flow
//     res.status(201).json({ success: true, data: purchaser });
//     // Delete local temp files if present
//     try {
//       const files = [req.files["aadharImage"][0], req.files["photo"][0]];
//       files.forEach((f) => {
//         if (f && f.path && fs.existsSync(f.path)) {
//           fs.unlink(f.path, (err) => {
//             if (err) console.error("Failed to remove temp upload:", err);
//           });
//         }
//       });
//     } catch (e) {
//       // Non-fatal cleanup error
//       console.warn("Cleanup error after purchaser creation:", e.message);
//     }
//   } catch (err) {
//     // Log full error on server for debugging
//     console.error(
//       "PurchaserController error:",
//       err && err.stack ? err.stack : err
//     );
//     try {
//       console.error("Request body keys:", Object.keys(req.body || {}));
//       console.error(
//         "Request files:",
//         Object.keys(req.files || {}).reduce((acc, k) => {
//           acc[k] = (req.files[k] || []).map((f) => ({
//             originalname: f.originalname,
//             size: f.size,
//           }));
//           return acc;
//         }, {})
//       );
//     } catch (logErr) {
//       console.warn(
//         "Failed to log request debug info:",
//         logErr && logErr.message
//       );
//     }
//     // If DEBUG_API is set, return verbose error details (temporary, opt-in)
//     if (process.env.DEBUG_API === "1") {
//       return res.status(500).json({
//         success: false,
//         message:
//           err && err.message ? String(err.message) : "Internal Server Error",
//         stack: err && err.stack ? String(err.stack) : undefined,
//       });
//     }

//     res.status(500).json({ success: false, message: "Internal Server Error" });
//   }
// };

// // Get all purchasers
// exports.getPurchasers = async (req, res) => {
//   try {
//     // If requester is admin, return all. Otherwise, return only purchasers created by the user (if authenticated).
//     const requester = req.user;
//     let query = {};
//     if (requester && requester.role === "admin") {
//       query = {};
//     } else if (requester && requester._id) {
//       query = { createdBy: requester._id };
//     } else {
//       // unauthenticated: return none by default to avoid exposing data
//       return res.json({ success: true, data: [] });
//     }

//     // Use a cache key scoped by requester id or 'all' for admin
//     const purchasers = await Purchaser.find(query).sort({ createdAt: -1 });
//     res.json({ success: true, data: purchasers });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // Get single purchaser by ID
// exports.getPurchaser = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const purchaser = await Purchaser.findById(id);
//     if (!purchaser) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Purchaser not found." });
//     }
//     res.json({ success: true, data: purchaser });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // Delete purchaser by ID
// exports.deletePurchaser = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const requester = req.user;
//     const purchaser = await Purchaser.findById(id);
//     if (!purchaser) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Purchaser not found." });
//     }

//     // Allow deletion if admin or owner
//     if (
//       requester &&
//       (requester.role === "admin" ||
//         String(purchaser.createdBy) === String(requester._id))
//     ) {
//       await Purchaser.findByIdAndDelete(id);
//       // purchaser cache removed - no invalidation needed
//       return res.json({ success: true, message: "Purchaser deleted." });
//     }

//     return res.status(403).json({
//       success: false,
//       message: "Not authorized to delete this purchaser.",
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

const Purchaser = require("../models/Purchaser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const { uploadToCloudinary } = require("../config/cloudinary");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const JWT_EXPIRES_IN = "7d";

// Create Purchaser
exports.createPurchaser = async (req, res) => {
  try {
    const { fullName, address, contactNo, email, password } = req.body;
    if (!req.files?.aadharImage || !req.files?.photo) {
      return res.status(400).json({
        success: false,
        message: "Aadhar image and photo are required.",
      });
    }

    const aadharFile = req.files.aadharImage[0];
    const photoFile = req.files.photo[0];

    // Upload to Cloudinary (best-effort): if one upload fails, fall back to
    // using the local file path so purchaser creation can continue in dev.
    let aadharUpload = null;
    let photoUpload = null;
    try {
      aadharUpload = await uploadToCloudinary(
        aadharFile,
        "meditrap/purchasers"
      );
    } catch (uploadErr) {
      console.warn(
        "Aadhar upload failed, falling back to local file. Error:",
        uploadErr && uploadErr.message
      );
      aadharUpload = {
        url: aadharFile && aadharFile.path ? `file://${aadharFile.path}` : null,
        public_id: null,
      };
    }

    try {
      photoUpload = await uploadToCloudinary(photoFile, "meditrap/purchasers");
    } catch (uploadErr) {
      console.warn(
        "Photo upload failed, falling back to local file. Error:",
        uploadErr && uploadErr.message
      );
      photoUpload = {
        url: photoFile && photoFile.path ? `file://${photoFile.path}` : null,
        public_id: null,
      };
    }

    // Hash password if provided
    let hashedPassword;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(String(password), salt);
    }

    const purchaser = await Purchaser.create({
      fullName,
      address,
      contactNo,
      email: email.toLowerCase(),
      password: hashedPassword,
      aadharImage: aadharUpload.url,
      photo: photoUpload.url,
      createdBy: req.user?._id,
    });

    // Cleanup temp files
    [aadharFile, photoFile].forEach(
      (f) => f.path && fs.existsSync(f.path) && fs.unlinkSync(f.path)
    );

    res.status(201).json({ success: true, data: purchaser });
  } catch (err) {
    // Log full error on server
    console.error(
      "Purchaser creation error:",
      err && err.stack ? err.stack : err
    );
    // Handle duplicate key error (email already exists)
    if (err && err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }
    // If DEBUG_API is enabled, return verbose error details to the client (dev only)
    if (process.env.DEBUG_API === "1") {
      return res.status(500).json({
        success: false,
        message:
          err && err.message
            ? String(err.message)
            : "Failed to create purchaser",
        stack: err && err.stack ? String(err.stack) : undefined,
      });
    }

    res
      .status(500)
      .json({ success: false, message: "Failed to create purchaser" });
  }
};

// Login Purchaser
exports.loginPurchaser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: "Email and password required." });

    const purchaser = await Purchaser.findOne({ email: email.toLowerCase() }).select("+password");
    if (!purchaser)
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });
    if (!purchaser.password)
      return res
        .status(403)
        .json({ success: false, message: "No password set." });

    const isMatch = await bcrypt.compare(password, purchaser.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });

    const token = jwt.sign(
      { userId: purchaser._id, role: "purchaser", email: purchaser.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      data: {
        token,
        purchaser: {
          id: purchaser._id,
          fullName: purchaser.fullName,
          email: purchaser.email,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// List Purchasers
exports.list = async (req, res) => {
  try {
    let query = {};
    if (req.user?.role !== "admin") {
      query.createdBy = req.user._id;
    }
    const purchasers = await Purchaser.find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    res.json({ success: true, data: purchasers });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to list purchasers" });
  }
};

// Get single Purchaser
exports.get = async (req, res) => {
  try {
    const purchaser = await Purchaser.findById(req.params.id).lean().exec();
    if (!purchaser)
      return res
        .status(404)
        .json({ success: false, message: "Purchaser not found" });
    res.json({ success: true, data: purchaser });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch purchaser" });
  }
};

// Delete Purchaser
exports.delete = async (req, res) => {
  try {
    const purchaser = await Purchaser.findById(req.params.id);
    if (!purchaser)
      return res
        .status(404)
        .json({ success: false, message: "Purchaser not found" });

    if (
      req.user?.role === "admin" ||
      String(req.user._id) === String(purchaser.createdBy)
    ) {
      await Purchaser.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: "Purchaser deleted" });
    }

    return res.status(403).json({
      success: false,
      message: "Not authorized to delete this purchaser",
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete purchaser" });
  }
};
