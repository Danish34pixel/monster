const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const Stockist = require("../models/Stockist");
const Staff = require("../models/Staff");
const { logEvent } = require("../utils/eventLog");

// Roles that must pay before login is granted
const SUBSCRIPTION_ROLES = new Set(["medical_owner", "user", "purchaser"]);
const { uploadToCloudinary } = require("../config/cloudinary");
const {
  upload,
  validateUploadedFiles,
  handleUploadError,
  cleanupUploads,
} = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const {
  authLimiter,
  passwordResetLimiter,
  refreshLimiter,
} = require("../middleware/rateLimiters");
const {
  signupSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  purchaserSignupSchema,
} = require("../validation/schemas");
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/passwordController");
const {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  buildTokenPayload,
} = require("../utils/tokenService");

const router = express.Router();

function sanitizeUser(userDoc, role) {
  if (!userDoc) return null;
  const obj =
    typeof userDoc.toObject === "function"
      ? userDoc.toObject()
      : { ...userDoc };
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  if (role) obj.role = role;
  return obj;
}

const optionalSingleUpload = (fieldName) => (req, res, next) => {
  if (req.is("multipart/form-data")) {
    return upload.single(fieldName)(req, res, next);
  }
  return next();
};

async function resolveStaffWorkplaceFromPayload(payload = {}) {
  const typeRaw = payload.workForType || payload.worksUnderType;
  const nameRaw = payload.workForName || payload.worksUnderName;
  const idRaw = payload.workForId || payload.workFor;
  const type = String(typeRaw || "")
    .trim()
    .toLowerCase();
  const normalizedType = type === "retailer" ? "medical" : type;
  const name = String(nameRaw || "").trim();
  const id = idRaw && String(idRaw).length === 24 ? idRaw : undefined;

  if (!["stockist", "medical"].includes(normalizedType)) {
    throw new Error("Please select where you work: stockist or medical.");
  }
  if (!name) {
    throw new Error("Please provide stockist/medical name.");
  }

  let resolvedId = id;
  if (!resolvedId) {
    if (normalizedType === "stockist") {
      const stockist = await Stockist.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
        approved: true,
        status: "approved",
      })
        .select("_id")
        .lean();
      if (stockist) resolvedId = stockist._id;
    } else {
      const medical = await User.findOne({
        medicalName: { $regex: `^${name}$`, $options: "i" },
        approved: true,
      })
        .select("_id")
        .lean();
      if (medical) resolvedId = medical._id;
    }
  }

  if (!resolvedId) {
    throw new Error(
      normalizedType === "stockist"
        ? "Selected wholesaler was not found. Please enter a valid stockist name."
        : "Selected retailer was not found. Please enter a valid medical name.",
    );
  }

  return {
    workForType: normalizedType,
    workForId: resolvedId,
    workForName: name,
    stockist: normalizedType === "stockist" ? resolvedId : undefined,
  };
}

async function resolveAccountByRole(email, role) {
  if (role === "stockist") {
    const stockist = await Stockist.findOne({ email }).select("+password");
    if (!stockist || !stockist.password) return null;
    return { role: "stockist", user: stockist };
  }

  if (role === "purchaser") {
    const purchaser = await Purchaser.findOne({ email }).select("+password");
    if (!purchaser || !purchaser.password) return null;
    return { role: "purchaser", user: purchaser };
  }

  if (role === "staff") {
    const staff = await Staff.findOne({ email }).select("+password");
    if (!staff || !staff.password) return null;
    return { role: "staff", user: staff };
  }

  const owner = await User.findOne({ email }).select("+password");
  if (!owner || !owner.password) return null;
  return { role: owner.role || "user", user: owner };
}

router.post(
  "/signup",
  authLimiter,
  optionalSingleUpload("drugLicenseImage"),
  validateUploadedFiles,
  handleUploadError,
  async (req, res) => {
    try {
      console.log("SIGNUP REQ", {
        contentType: req.headers["content-type"],
        isMultipart: req.is("multipart/form-data"),
        body: req.body,
        file: !!req.file,
      });
      const parse = signupSchema.safeParse(req.body || {});
      if (!parse.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid request payload",
          errors: parse.error.issues.map((i) => i.message),
        });
      }

      const payload = parse.data;
      const email = payload.email.toLowerCase();
      const drugLicenseNo = payload.drugLicenseNo.toUpperCase();

      const existingUser = await User.findOne({
        $or: [{ email }, { drugLicenseNo }],
      }).lean();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message:
            existingUser.email === email
              ? "Email already registered"
              : "Drug license number already registered",
        });
      }

      let drugLicenseImageUrl;
      if (req.file) {
        const uploadResult = await uploadToCloudinary(
          req.file,
          "medtek/licenses",
        );
        drugLicenseImageUrl = uploadResult.url;
      } else if (payload.drugLicenseImage) {
        drugLicenseImageUrl = payload.drugLicenseImage;
      } else {
        return res.status(400).json({
          success: false,
          message:
            "drugLicenseImage is required. Upload a file or provide a valid image URL.",
        });
      }

      const hashedPassword = await bcrypt.hash(payload.password, 12);

      const user = await User.create({
        medicalName: payload.medicalName,
        ownerName: payload.ownerName,
        address: payload.address,
        email,
        contactNo: payload.contactNo,
        drugLicenseNo,
        drugLicenseImage: drugLicenseImageUrl,
        password: hashedPassword,
        role: "medical_owner",
        accountStatus: "pending_payment",
        paymentStatus: "unpaid",
      });

      logEvent(user._id, "User", "signup_submitted", { email, role: "medical_owner" });

      // Issue tokens so frontend can immediately call /api/payment/create-order
      const tokenPayload = buildTokenPayload(user, "medical_owner");
      return res.status(201).json({
        success: true,
        message: "Medical store registered successfully. Please complete payment.",
        user: sanitizeUser(user, "medical_owner"),
        accessToken: issueAccessToken(tokenPayload),
        refreshToken: issueRefreshToken(tokenPayload),
        requiresPayment: true,
      });
    } catch (error) {
      console.error("Signup error:", error && error.message, error);
      if (error && error.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Duplicate value detected" });
      }
      return res.status(500).json({
        success: false,
        message: "Server error during registration",
        error: error.message || String(error),
      });
    }
  },
  cleanupUploads,
);

router.get("/medical-owners", async (req, res) => {
  try {
    const data = await User.find({ approved: true })
      .select("medicalName ownerName")
      .sort({ medicalName: 1 })
      .lean();
    return res.json({
      success: true,
      data: (data || []).map((u) => ({
        _id: u._id,
        name: u.medicalName,
        ownerName: u.ownerName,
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to load medical owners" });
  }
});

router.post(
  "/staff-signup",
  authLimiter,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "aadharCard", maxCount: 1 },
  ]),
  validateUploadedFiles,
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.files || !req.files.image || !req.files.aadharCard) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Image and Aadhar card are required",
          });
      }

      const {
        fullName,
        contact,
        email,
        address,
        password,
        currentWorkingPlace,
        isFresher,
      } = req.body;
      if (!fullName || !contact || !email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "All fields are required" });
      }

      const normalizedEmail = email.toLowerCase();
      const existing = await Staff.findOne({ email: normalizedEmail });
      if (existing) {
        return res
          .status(409)
          .json({ success: false, message: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const [imgRes, aadharRes] = await Promise.all([
        uploadToCloudinary(req.files.image[0], "medtek/staff"),
        uploadToCloudinary(req.files.aadharCard[0], "medtek/staff"),
      ]);
      const workplace = await resolveStaffWorkplaceFromPayload(req.body || {});

      const staff = await Staff.create({
        fullName,
        contact,
        email: normalizedEmail,
        address,
        password: hashedPassword,
        currentWorkingPlace,
        isFresher: isFresher === "true" || isFresher === true,
        image: imgRes.url,
        aadharCard: aadharRes.url,
        imagePublicId: imgRes.public_id,
        aadharPublicId: aadharRes.public_id,
        approved: false,
        approvalStatus: "pending",
        ...workplace,
      });

      return res.status(201).json({
        success: true,
        message: "Staff registration successful",
        user: sanitizeUser(staff, "staff"),
      });
    } catch (error) {
      if (
        String(error.message || "").includes("Please select") ||
        String(error.message || "").includes("Please provide") ||
        String(error.message || "").includes("not found")
      ) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return res
        .status(500)
        .json({ success: false, message: "Server error during staff signup" });
    }
  },
  cleanupUploads,
);

router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  async (req, res) => {
    try {
      const { email, password, role } = req.body;
      const normalizedEmail = email.toLowerCase();

      const account = await resolveAccountByRole(normalizedEmail, role);
      if (!account) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      const { user } = account;
      const isMatch = await bcrypt.compare(password, String(user.password));
      if (!isMatch) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      if (account.role === "stockist") {
        if (user.status !== "approved") {
          return res.status(403).json({
            success: false,
            message:
              user.status === "declined"
                ? "Your registration was declined by admin."
                : "Your account is under review. Please wait for admin approval.",
          });
        }
      }

      if (account.role === "staff") {
        const status =
          user.approvalStatus || (user.approved ? "approved" : "pending");
        if (status !== "approved") {
          return res.status(403).json({
            success: false,
            message:
              status === "declined"
                ? "Your staff request was declined by the selected organization."
                : "Your staff account is pending approval from your organization.",
            status,
          });
        }
      }

      // Subscription gate: medical_owner and purchaser must be active
      if (SUBSCRIPTION_ROLES.has(account.role)) {
        const acctStatus = user.accountStatus;
        if (acctStatus && acctStatus !== "active") {
          const messages = {
            pending_payment: "Please complete your subscription payment to access your account.",
            pending_admin_verification: "Payment received. Your account is awaiting admin verification.",
            rejected: "Your account has been rejected. Please contact support.",
          };
          logEvent(user._id, account.role === "purchaser" ? "Purchaser" : "User", "login_blocked", {
            reason: acctStatus,
          });
          return res.status(403).json({
            success: false,
            message: messages[acctStatus] || "Account not active.",
            accountStatus: acctStatus,
          });
        }

        // Check subscription expiry for active accounts
        if (acctStatus === "active" && user.subscriptionEndDate) {
          const expired = new Date(user.subscriptionEndDate) < new Date();
          if (expired) {
            logEvent(user._id, account.role === "purchaser" ? "Purchaser" : "User", "login_blocked", {
              reason: "subscription_expired",
              expiredAt: user.subscriptionEndDate,
            });
            return res.status(403).json({
              success: false,
              message: "Your subscription has expired. Please renew to continue.",
              accountStatus: "subscription_expired",
              subscriptionEndDate: user.subscriptionEndDate,
            });
          }
        }
      }

      const payload = buildTokenPayload(user, account.role);
      const accessToken = issueAccessToken(payload);
      const refreshToken = issueRefreshToken(payload);

      logEvent(user._id, account.role === "purchaser" ? "Purchaser" : "User", "login_success", {
        role: account.role,
      });

      return res.json({
        success: true,
        message: "Login successful",
        accessToken,
        refreshToken,
        user: sanitizeUser(user, account.role),
      });
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: "Server error during login" });
    }
  },
);

router.post(
  "/refresh",
  refreshLimiter,
  validateBody(refreshSchema),
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const decoded = verifyRefreshToken(refreshToken);

      const account = await resolveAccountByRole(
        String(decoded.email).toLowerCase(),
        decoded.role,
      );
      if (!account || String(account.user._id) !== String(decoded.userId)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid refresh token" });
      }

      const payload = buildTokenPayload(account.user, decoded.role);
      return res.json({
        success: true,
        accessToken: issueAccessToken(payload),
        refreshToken: issueRefreshToken(payload),
      });
    } catch (error) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid refresh token" });
    }
  },
);

router.get("/me", authenticate, async (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user, req.user.role),
  });
});

router.get("/status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.length !== 24)
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const stockist = await Stockist.findById(id)
      .select("approved declined status")
      .lean();
    if (stockist) return res.json({ success: true, data: stockist });

    const user = await User.findById(id)
      .select("approved declined status")
      .lean();
    if (user) return res.json({ success: true, data: user });

    const purchaser = await Purchaser.findById(id)
      .select("approved verified status")
      .lean();
    if (purchaser)
      return res.json({
        success: true,
        data: {
          approved: purchaser.approved || purchaser.verified,
          declined: false,
          status: purchaser.approved ? "approved" : "processing",
        },
      });

    const staff = await Staff.findById(id)
      .select("approved approvalStatus")
      .lean();
    if (staff) {
      const status =
        staff.approvalStatus || (staff.approved ? "approved" : "processing");
      return res.json({
        success: true,
        data: {
          approved: status === "approved",
          declined: status === "declined",
          status,
        },
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "Record not found" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/forgot-password",
  passwordResetLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validateBody(resetPasswordSchema),
  resetPassword,
);

router.put(
  "/profile",
  authenticate,
  upload.single("drugLicenseImage"),
  validateUploadedFiles,
  handleUploadError,
  async (req, res) => {
    try {
      if (req.user.role !== "user" && req.user.role !== "admin") {
        return res
          .status(403)
          .json({
            success: false,
            message: "Only medical owners can update profile",
          });
      }

      const parse = updateProfileSchema.safeParse(req.body || {});
      if (!parse.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid request payload",
          errors: parse.error.issues.map((i) => i.message),
        });
      }

      const updateData = { ...parse.data };
      if (req.file) {
        const uploadResult = await uploadToCloudinary(
          req.file,
          "medtek/licenses",
        );
        updateData.drugLicenseImage = uploadResult.url;
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        updateData,
        {
          new: true,
          runValidators: true,
        },
      ).select("-password -resetPasswordToken -resetPasswordExpires");

      return res.json({
        success: true,
        message: "Profile updated successfully",
        user: sanitizeUser(updatedUser, updatedUser.role || "user"),
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Server error while updating profile",
        });
    }
  },
  cleanupUploads,
);

router.post("/logout", authenticate, async (req, res) => {
  return res.json({ success: true, message: "Logout successful" });
});

router.post(
  "/purchaser-signup",
  authLimiter,
  upload.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "personalPhoto", maxCount: 1 },
  ]),
  validateUploadedFiles,
  handleUploadError,
  async (req, res) => {
    try {
      const parse = purchaserSignupSchema.safeParse(req.body || {});
      if (!parse.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid request payload",
          errors: parse.error.issues.map((i) => i.message),
        });
      }

      if (
        !req.files ||
        !req.files.aadharImage ||
        !req.files.personalPhoto ||
        req.files.aadharImage.length === 0 ||
        req.files.personalPhoto.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Aadhar image and personal photo are required",
        });
      }

      const payload = parse.data;
      const email = payload.email.toLowerCase();
      const [userEx, stockistEx, purchaserEx, staffEx] = await Promise.all([
        User.findOne({ email }).lean(),
        Stockist.findOne({ email }).lean(),
        Purchaser.findOne({ email }).lean(),
        Staff.findOne({ email }).lean(),
      ]);

      if (userEx || stockistEx || purchaserEx || staffEx) {
        return res
          .status(409)
          .json({ success: false, message: "Email already registered" });
      }

      const [aadharUpload, photoUpload] = await Promise.all([
        uploadToCloudinary(
          req.files.aadharImage[0],
          "medi-trap/purchasers/aadhar",
        ),
        uploadToCloudinary(
          req.files.personalPhoto[0],
          "medi-trap/purchasers/photo",
        ),
      ]);

      const hashedPassword = await bcrypt.hash(payload.password, 12);
      const purchaser = await Purchaser.create({
        fullName: payload.fullName,
        email,
        address: payload.address,
        contactNo: payload.contactNo,
        password: hashedPassword,
        aadharImage: aadharUpload.url,
        photo: photoUpload.url,
        approved: false,
        verified: false,
        accountStatus: "pending_payment",
        paymentStatus: "unpaid",
      });

      logEvent(purchaser._id, "Purchaser", "signup_submitted", { email, role: "purchaser" });

      // Issue tokens so frontend can immediately call /api/payment/create-order
      const tokenPayload = buildTokenPayload(purchaser, "purchaser");

      return res.status(201).json({
        success: true,
        message: "Purchaser signup successful! Please complete payment to activate your account.",
        accessToken: issueAccessToken(tokenPayload),
        refreshToken: issueRefreshToken(tokenPayload),
        requiresPayment: true,
        purchaser: {
          _id: purchaser._id,
          fullName: purchaser.fullName,
          accountStatus: "pending_payment",
        },
      });
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
  cleanupUploads,
);

module.exports = router;
