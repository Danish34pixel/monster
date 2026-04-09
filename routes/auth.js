const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const Stockist = require("../models/Stockist");
const { uploadToCloudinary } = require("../config/cloudinary");
const {
  upload,
  handleUploadError,
  cleanupUploads,
} = require("../middleware/upload");
// sanitizers removed per user request
// Note: a local `authenticate` implementation (with blacklist support)
// is defined later in this file. Do not import the middleware's
// `authenticate` here to avoid duplicate declaration/conflict.
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/passwordController");
const cache = require("../utils/cache");
const router = express.Router();

// Rate limiting for auth routes
const rateLimit = require("express-rate-limit");
const isDevelopment = process.env.NODE_ENV === "development";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs (production default)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
});

if (!isDevelopment) {
  router.use(authLimiter);
}
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.slice(7);

    // Debug: log a short token snippet to help trace which token the client sent
    try {
      console.debug("Auth: tokenSnippet ->", token.slice(0, 12) + "...");
    } catch (e) {}

    // Check if token is blacklisted (Redis-backed). Fall back to in-memory set.
    try {
      const blackKey = `blacklist:token:${token}`;
      const isBlack = await cache.getJson(blackKey);
      if (isBlack) {
        return res
          .status(401)
          .json({ success: false, message: "Token has been invalidated." });
      }
    } catch (e) {
      // ignore cache errors and check in-memory fallback
      if (tokenBlacklist.has(token)) {
        return res
          .status(401)
          .json({ success: false, message: "Token has been invalidated." });
      }
    }

    // Verify token with consistent fallback secret
    const secret = process.env.JWT_SECRET || "supersecretkey";
    const decoded = jwt.verify(token, secret);
    // Debug: show decoded token payload fields (non-sensitive)
    try {
      console.debug("Auth: decoded ->", {
        userId: decoded && decoded.userId,
        email: decoded && decoded.email,
        role: decoded && decoded.role,
      });
    } catch (e) {}

    let user = null;
    try {
      // Try cache first for medical owner (User) profiles
      if (decoded && decoded.role && decoded.role === "stockist") {
        user = await Stockist.findById(decoded.userId).select("-password");
      } else if (decoded && decoded.role && decoded.role === "purchaser") {
        user = await Purchaser.findById(decoded.userId).select("-password");
      } else {
        // For primary app owners (User), prefer cached copy
        const cacheKey = `owner:user:${decoded.userId}`;
        try {
          const cached = await cache.getJson(cacheKey);
          if (cached) {
            console.log(`Auth: owner cache hit -> ${cacheKey}`);
            user = cached;
          } else {
            console.log(`Auth: owner cache miss -> ${cacheKey}`);
          }
        } catch (e) {
          console.warn("Auth: owner cache read error:", e && e.message);
          user = null;
        }

        if (!user) {
          user = await User.findById(decoded.userId).select("-password");
          if (!user) {
            user = await Stockist.findById(decoded.userId).select("-password");
            if (!user) {
              user = await Purchaser.findById(decoded.userId).select("-password");
            }
          } else {
            // Store lightweight user profile in cache for future requests
            try {
              await cache.setJson(cacheKey, user, 60 * 5);
              console.log(`Auth: owner cache set -> ${cacheKey}`);
            } catch (e) {
              console.warn("Auth: owner cache set error:", e && e.message);
            }
          }
        }
      }
    } catch (e) {
      user = null;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Token verification failed.",
    });
  }
};

// @route   POST /api/auth/signup
// @desc    Register a new medical store
// @access  Public
router.post(
  "/signup",
  upload.single("drugLicenseImage"),
  handleUploadError,
  async (req, res) => {
    try {
      // Diagnostic: log Content-Type and presence of uploaded file to aid
      // debugging of 500s coming from deployed frontend (missing multipart/form)
      try {
        console.debug(
          `Signup diagnostic: Content-Type=${
            req.headers["content-type"]
          }, hasFile=${!!req.file}, hasFiles=${!!req.files}`
        );
      } catch (e) {}
      let {
        medicalName,
        ownerName,
        address,
        email,
        contactNo,
        drugLicenseNo,
        password,
      } = req.body || {};

      // Normalize common fields early so validation and duplicate checks
      // behave consistently across environments (frontend may send
      // capitalized emails or lowercase/uppercase license numbers).
      email = typeof email === "string" ? email.toLowerCase().trim() : email;
      drugLicenseNo =
        typeof drugLicenseNo === "string"
          ? drugLicenseNo.toUpperCase().trim()
          : drugLicenseNo;

      // Check if required fields are present
      if (
        !medicalName ||
        !ownerName ||
        !address ||
        !email ||
        !contactNo ||
        !drugLicenseNo ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message: "All fields are required",
        });
      }

      // Check if user already exists - use lean() to get a plain object
      // (avoids some Mongoose doc edge cases during error handling).
      const existingUser = await User.findOne({
        $or: [{ email }, { drugLicenseNo }],
      }).lean();

      if (existingUser) {
        const duplicateField =
          existingUser.email && existingUser.email === email
            ? "email"
            : "drugLicenseNo";
        return res.status(409).json({
          success: false,
          message:
            duplicateField === "email"
              ? "Email already registered"
              : "Drug license number already registered",
        });
      }

      // Upload image to Cloudinary (best-effort) only when a file exists.
      // If `req.file` is present we attempt to upload; otherwise use a
      // placeholder so signup can proceed. This avoids a 500 when the
      // frontend fails to send multipart/form-data.
      let cloudinaryResult = null;
      if (!req.file) {
        console.warn(
          "Signup warning: no drugLicenseImage provided; proceeding with placeholder"
        );
        cloudinaryResult = { url: "placeholder", public_id: null };
      } else {
        try {
          cloudinaryResult = await uploadToCloudinary(
            req.file,
            "medtek/licenses"
          );
        } catch (uploadErr) {
          console.warn(
            "Cloudinary upload failed during signup, falling back to local file:",
            uploadErr && uploadErr.message
          );
          cloudinaryResult = {
            url: `file://${req.file.path}`,
            public_id: null,
          };
        }
      }

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create new user
      const user = new User({
        medicalName,
        ownerName,
        address,
        email: email.toLowerCase(),
        contactNo,
        drugLicenseNo: drugLicenseNo.toUpperCase(),
        drugLicenseImage:
          cloudinaryResult && cloudinaryResult.url
            ? cloudinaryResult.url
            : `file://${req.file && req.file.path}`,
        password: hashedPassword,
      });

      await user.save();

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      res.status(201).json({
        success: true,
        message: "Medical store registered successfully",
        user: userResponse,
      });
    } catch (error) {
      // Enhanced logging to aid debugging of 500 during signup
      console.error("Signup error:", error && error.message);
      if (error && error.stack) console.error(error.stack);
      // Log Mongo duplicate-key info when present to aid debugging on deployed instances
      try {
        if (error && typeof error.code !== "undefined") {
          console.error("Signup error code:", error.code);
        }
        if (error && error.keyValue) {
          console.error("Signup duplicate keyValue:", error.keyValue);
        }
      } catch (e) {
        // ignore
      }
      try {
        console.error("Request body:", { ...(req.body || {}) });
        console.error(
          "Uploaded file:",
          req.file && {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: req.file.path,
          }
        );
      } catch (e) {}

      // Map common errors to clearer HTTP responses
      // Mongoose validation errors
      if (error && error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((e) => e.message);
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: messages,
        });
      }

      // Duplicate key error (MongoDB may set different error.name values
      // across driver versions; check the numeric code instead so we map
      // 11000 to a client-friendly 4xx response instead of a 500.)
      if (error && error.code === 11000) {
        const key = Object.keys(error.keyValue || {}).join(", ") || "field";
        return res
          .status(409)
          .json({ success: false, message: `Duplicate value for ${key}` });
      }

      // Cloudinary upload failed (wraps original message)
      if (
        error &&
        /Cloudinary upload failed/i.test(String(error.message || ""))
      ) {
        return res.status(502).json({
          success: false,
          message: "Image upload failed",
          error: error.message,
        });
      }

      // Fallback: include stack in development for easier debugging
      const isDev = process.env.NODE_ENV === "development";
      const payload = {
        success: false,
        message: "Server error during registration",
      };
      if (isDev && error && error.stack) payload.stack = error.stack;
      return res.status(500).json(payload);
    }
  },
  cleanupUploads
);

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // Check if required fields are present
    if (!email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Email, password, and role are required",
      });
    }

    let user = null;
    if (role === "stockist") {
      const stockist = await Stockist.findOne({ email: email.toLowerCase() });
      if (!stockist || !stockist.password) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      const isMatchStockist = await bcrypt.compare(password, stockist.password);
      if (!isMatchStockist) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      if (!stockist.status || stockist.status !== "approved") {
        if (stockist.status === "declined") {
          return res.status(403).json({
            success: false,
            message: "Your registration was declined by admin.",
          });
        }
        return res.status(403).json({
          success: false,
          message: "Your account is under review. Please wait for admin approval.",
        });
      }
      user = {
        _id: stockist._id,
        medicalName: stockist.name || stockist.medicalName || "",
        ownerName: stockist.contactPerson || "",
        address: stockist.address || "",
        email: stockist.email,
        contactNo: stockist.phone || stockist.contact || "",
        role: "stockist",
        status: stockist.status || "approved",
        approved: !!stockist.approved,
      };
    } else if (role === "medicalOwner") {
      const medicalOwner = await User.findOne({ email: email.toLowerCase() });
      if (!medicalOwner || !medicalOwner.password) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      const isMatch = await bcrypt.compare(password, medicalOwner.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      user = medicalOwner;
    } else if (role === "purchaser") {
      const purchaser = await Purchaser.findOne({ email: email.toLowerCase() });
      if (!purchaser || !purchaser.password) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      const isMatchPurchaser = await bcrypt.compare(password, purchaser.password);
      if (!isMatchPurchaser) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }
      user = {
        _id: purchaser._id,
        fullName: purchaser.fullName,
        address: purchaser.address,
        email: purchaser.email,
        contactNo: purchaser.contactNo,
        role: "purchaser",
      };
    } else {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    // Create JWT token
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role || role,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET || "supersecretkey", {
      expiresIn: "7d", // Token expires in 7 days
    });

    // Remove password from response (handle Mongoose doc vs plain object)
    let userResponse;
    try {
      userResponse = typeof user.toObject === "function" ? user.toObject() : { ...user };
    } catch (e) {
      userResponse = { ...user };
    }
    if (userResponse && userResponse.password) delete userResponse.password;

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", authenticate, async (req, res) => {
  try {
    console.log(`/api/auth/me called for userId=${req.user && req.user._id}`);
    res.json({
      success: true,
      user: req.user,
      role: (req.user && req.user.role) || (req.decoded && req.decoded.role) || null,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching profile",
    });
  }
});

// Password reset endpoints
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Development-only: send a test email and return preview URL (Ethereal)
if (isDevelopment) {
  const { sendMail } = require("../utils/mailer");
  router.post("/debug/send-test-email", async (req, res) => {
    try {
      const { to, subject, html, text, from } = req.body || {};
      if (!to)
        return res
          .status(400)
          .json({ success: false, message: "to is required" });
      const result = await sendMail({
        to,
        subject: subject || "Test email",
        html,
        text,
        from,
      });
      return res.json({ success: true, previewUrl: result.previewUrl || null });
    } catch (err) {
      console.error("debug send-test-email error:", err && err.message);
      return res
        .status(500)
        .json({ success: false, message: err && err.message });
    }
  });
}

// Protected test-send endpoint for staging/production
// Usage: POST /api/auth/test-send-email { to, subject, html, text }
// Requires: Authorization: Bearer <token>
router.post("/test-send-email", authenticate, async (req, res) => {
  try {
    const { sendMail } = require("../utils/mailer");
    const { to, subject, html, text, from } = req.body || {};
    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "to is required" });

    const result = await sendMail({
      to,
      subject: subject || "Test email",
      html,
      text,
      from,
    });

    // Return provider info but avoid leaking full auth details
    return res.json({
      success: true,
      previewUrl: result.previewUrl || null,
      info: !!result.info,
    });
  } catch (err) {
    console.error("test-send-email error:", err && err.message);
    return res
      .status(500)
      .json({ success: false, message: err && err.message });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put(
  "/profile",
  authenticate,
  upload.single("drugLicenseImage"),
  handleUploadError,
  async (req, res) => {
    try {
      const { medicalName, ownerName, address, contactNo } = req.body;

      const updateData = {};

      // Only update fields that are provided
      if (medicalName) updateData.medicalName = medicalName;
      if (ownerName) updateData.ownerName = ownerName;
      if (address) updateData.address = address;
      if (contactNo) updateData.contactNo = contactNo;

      // Handle image upload if provided
      if (req.file) {
        let cloudinaryResultProfile = null;
        try {
          cloudinaryResultProfile = await uploadToCloudinary(
            req.file,
            "medtek/licenses"
          );
        } catch (uploadErr) {
          console.warn(
            "Cloudinary upload failed during profile update, falling back to local file:",
            uploadErr && uploadErr.message
          );
          cloudinaryResultProfile = {
            url: `file://${req.file.path}`,
            public_id: null,
          };
        }
        updateData.drugLicenseImage = cloudinaryResultProfile.url;
      }

      // Update user
      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        updateData,
        { new: true, runValidators: true }
      ).select("-password");

      // Update cache for owner profile
      try {
        const cacheKey = `owner:user:${req.user._id}`;
        await cache.setJson(cacheKey, updatedUser, 60 * 5);
      } catch (e) {
        // ignore cache set errors
      }

      res.json({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while updating profile",
      });
    }
  },
  cleanupUploads
);

// @route   POST /api/auth/logout
// @desc    Logout user and invalidate token
// @access  Private
router.post("/logout", authenticate, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // Add token to in-memory fallback
      tokenBlacklist.add(token);
      // Add token to Redis blacklist with TTL derived from token exp
      try {
        const ttl = ttlFromToken(token) || 60 * 60 * 24 * 7; // fallback 7 days
        if (ttl > 0) {
          await cache.setJson(`blacklist:token:${token}`, true, ttl);
        } else {
          // If no exp found, set a reasonable TTL
          await cache.setJson(
            `blacklist:token:${token}`,
            true,
            60 * 60 * 24 * 7
          );
        }
      } catch (e) {
        console.warn(
          "Failed to persist token blacklist to Redis:",
          e && e.message
        );
      }
    }

    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during logout",
    });
  }
});

// @route   GET /api/auth/users
// @desc    Get all users
// @access  Public
router.get("/users", async (req, res) => {
  try {
    console.log("Fetching all users..."); // Debugging log
    // const users = await User.find().select("-password"); // Exclude passwords from the response
    const users = await User.find().select("-password -contactNo -address -drugLicenseImage");
    console.log("Users fetched:", users); // Debugging log
    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users",
    });
  }
});

// Approve user
router.patch("/users/:id/approve", async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Persist approval on the User model using existing schema field
    user.isVerified = true;
    // optionally set a timestamp if desired (won't persist unless added to schema)
    // user.approvedAt = new Date();
    await user.save();

    res.status(200).json({
      message: "User approved successfully",
      data: { approvedAt: new Date() },
      user,
    });
  } catch (error) {
    console.error("Error approving user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

// ------------------------- Purchaser self-signup -------------------------
// POST /api/auth/purchaser-signup
// multipart form: fullName, email, password, aadharNo, aadharImage (file), personalPhoto (file)
// ----------------------------
// 🧾 Purchaser Signup Route
// ----------------------------
router.post(
  "/purchaser-signup",
  upload.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "personalPhoto", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("📩 Purchaser signup request received");
      console.log("Body keys:", Object.keys(req.body || {}));
      console.log("File fields:", Object.keys(req.files || {}));

      const { fullName, email, password, address, contactNo } = req.body;

      // ----------------------------
      // ✅ 1. Validate text fields
      // ----------------------------
      if (!fullName || !email || !password || !address || !contactNo) {
        console.warn("⚠ Missing required text fields");
        return res
          .status(400)
          .json({ success: false, message: "All fields are required" });
      }

      // ----------------------------
      // ✅ 2. Validate required files
      // ----------------------------
      if (
        !req.files ||
        !req.files.aadharImage ||
        !req.files.personalPhoto ||
        req.files.aadharImage.length === 0 ||
        req.files.personalPhoto.length === 0
      ) {
        console.warn("⚠ Missing one or both required files");
        return res.status(400).json({
          success: false,
          message: "Aadhar image and personal photo are required",
        });
      }

      // ----------------------------
      // ✅ 3. Check if user already exists
      // ----------------------------
      const existing = await Purchaser.findOne({ email });
      if (existing) {
        console.warn("⚠ Email already exists:", email);
        return res
          .status(400)
          .json({ success: false, message: "Email already registered" });
      }

      // ----------------------------
      // ✅ 4. Hash password
      // ----------------------------
      const hashedPassword = await bcrypt.hash(password, 10);

      // ----------------------------
      // ✅ 5. Upload images to Cloudinary
      // ----------------------------
      const aadharPath = req.files.aadharImage[0].path;
      const photoPath = req.files.personalPhoto[0].path;

      console.log("☁ Uploading images...");
      const [aadharUpload, photoUpload] = await Promise.all([
        uploadToCloudinary(req.files.aadharImage[0], "medi-trap/purchasers/aadhar"),
        uploadToCloudinary(req.files.personalPhoto[0], "medi-trap/purchasers/photo"),
      ]);

      console.log("✅ Upload success");

      // ----------------------------
      // ✅ 6. Save Purchaser to DB
      // ----------------------------
      const newPurchaser = new Purchaser({
        fullName,
        email,
        address,
        contactNo,
        password: hashedPassword,
        aadharImage: aadharUpload.url,
        photo: photoUpload.url,
        verified: false,
      });

      await newPurchaser.save();

      // ----------------------------
      // ✅ 7. Issue JWT for verification request
      // ----------------------------
      const token = jwt.sign(
        { userId: newPurchaser._id, role: "purchaser", email: newPurchaser.email },
        process.env.JWT_SECRET || "supersecretkey",
        { expiresIn: "7d" }
      );

      console.log("🎉 Purchaser saved successfully:", email);
      res.status(201).json({
        success: true,
        message: "Purchaser signup successful! Awaiting stockist verification.",
        token,
        purchaser: {
          _id: newPurchaser._id,
          fullName: newPurchaser.fullName,
          email: newPurchaser.email,
          approved: false,
        },
      });
    } catch (err) {
      console.error("❌ Purchaser signup failed:", err);

      // Cloudinary size limit or multer issue
      if (err.message?.includes("File too large")) {
        return res.status(413).json({
          success: false,
          message: "Uploaded file too large. Please upload images under 5MB.",
        });
      }

      res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: err.message,
      });
    }
  }
);
