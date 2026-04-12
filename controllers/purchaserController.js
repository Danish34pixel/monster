const Purchaser = require("../models/Purchaser");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const { uploadToCloudinary } = require("../config/cloudinary");
const {
  issueAccessToken,
  issueRefreshToken,
  buildTokenPayload,
} = require("../utils/tokenService");

function safePurchaser(purchaser) {
  if (!purchaser) return null;
  return {
    _id: purchaser._id,
    fullName: purchaser.fullName,
    approved: !!purchaser.approved,
    verified: !!purchaser.verified,
    createdAt: purchaser.createdAt,
    updatedAt: purchaser.updatedAt,
  };
}

exports.createPurchaser = async (req, res) => {
  try {
    const { fullName, address, contactNo, email, password } = req.body;

    if (!req.files?.aadharImage || !req.files?.photo) {
      return res.status(400).json({
        success: false,
        message: "Aadhar image and photo are required.",
      });
    }

    const normalizedEmail = String(email || "").toLowerCase().trim();
    const existing = await Purchaser.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    const aadharFile = req.files.aadharImage[0];
    const photoFile = req.files.photo[0];

    const [aadharUpload, photoUpload] = await Promise.all([
      uploadToCloudinary(aadharFile, "meditrap/purchasers"),
      uploadToCloudinary(photoFile, "meditrap/purchasers"),
    ]);

    const hashedPassword = await bcrypt.hash(String(password), 12);

    const purchaser = await Purchaser.create({
      fullName,
      address,
      contactNo,
      email: normalizedEmail,
      password: hashedPassword,
      aadharImage: aadharUpload.url,
      photo: photoUpload.url,
      createdBy: req.user?._id,
    });

    [aadharFile, photoFile].forEach((f) => {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });

    return res.status(201).json({ success: true, data: safePurchaser(purchaser) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    return res.status(500).json({ success: false, message: "Failed to create purchaser" });
  }
};

exports.loginPurchaser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required." });
    }

    const purchaser = await Purchaser.findOne({ email: String(email).toLowerCase() }).select("+password");
    if (!purchaser || !purchaser.password) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, purchaser.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const payload = buildTokenPayload(purchaser, "purchaser");

    return res.json({
      success: true,
      data: {
        accessToken: issueAccessToken(payload),
        refreshToken: issueRefreshToken(payload),
        purchaser: safePurchaser(purchaser),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

exports.list = async (req, res) => {
  try {
    const query = req.user?.role === "admin" ? {} : { createdBy: req.user._id };
    const purchasers = await Purchaser.find(query)
      .select("fullName email contactNo address photo aadharImage approved verified createdBy createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: purchasers });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to list purchasers" });
  }
};

exports.get = async (req, res) => {
  try {
    const purchaser = await Purchaser.findById(req.params.id)
      .select("fullName email contactNo address photo aadharImage approved verified createdBy createdAt updatedAt")
      .lean();

    if (!purchaser) {
      return res.status(404).json({ success: false, message: "Purchaser not found" });
    }

    const isAdmin = req.user?.role === "admin";
    const isOwner = purchaser.createdBy && String(purchaser.createdBy) === String(req.user?._id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    return res.json({ success: true, data: purchaser });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch purchaser" });
  }
};

exports.delete = async (req, res) => {
  try {
    const purchaser = await Purchaser.findById(req.params.id);
    if (!purchaser) {
      return res.status(404).json({ success: false, message: "Purchaser not found" });
    }

    const isAdmin = req.user?.role === "admin";
    const isOwner = purchaser.createdBy && String(purchaser.createdBy) === String(req.user?._id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this purchaser" });
    }

    await Purchaser.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Purchaser deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete purchaser" });
  }
};
