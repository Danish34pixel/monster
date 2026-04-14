const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Stockist = require("../models/Stockist");
const User = require("../models/User");
const { uploadToCloudinary } = require("../config/cloudinary");
const {
  issueAccessToken,
  issueRefreshToken,
  buildTokenPayload,
} = require("../utils/tokenService");

function sanitizeStockist(stockist) {
  if (!stockist) return null;
  const obj = typeof stockist.toObject === "function" ? stockist.toObject() : { ...stockist };
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  return obj;
}

function normalizeMedicineKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function extractStockistMedicineNames(stockist = {}) {
  const names = [];

  if (Array.isArray(stockist.medicines)) {
    for (const item of stockist.medicines) {
      if (typeof item === "string") {
        names.push(item);
      } else if (item && typeof item === "object") {
        names.push(item.name || item.medicineName || item.label || "");
      }
    }
  }

  if (Array.isArray(stockist.availableItems)) {
    for (const item of stockist.availableItems) {
      if (typeof item === "string") {
        names.push(item);
      } else if (item && typeof item === "object") {
        names.push(item.name || item.medicineName || item.label || "");
      }
    }
  }

  return names.filter(Boolean);
}

function buildStockistPayload(body = {}) {
  const payload = {
    name: body.name,
    contactPerson: body.contactPerson,
    phone: body.phone,
    email: body.email ? String(body.email).toLowerCase().trim() : undefined,
    licenseNumber: body.licenseNumber,
    roleType: body.roleType,
    cntxNumber: body.cntxNumber,
  };

  if (body.address) {
    if (typeof body.address === "object") {
      payload.address = {
        street: body.address.street,
        city: body.address.city,
        state: body.address.state,
        pincode: body.address.pincode,
      };
    } else if (typeof body.address === "string") {
      // Fallback for legacy string format: "Street, City, State - Pincode"
      const parts = body.address.split(",");
      payload.address = {
        street: parts[0]?.trim() || "",
        city: parts[1]?.trim() || "",
        state: parts[2]?.split("-")[0]?.trim() || "",
        pincode: parts[2]?.split("-")[1]?.trim() || "",
      };
    }
  }

  if (body.dob) {
    const d = new Date(body.dob);
    if (!Number.isNaN(d.getTime())) payload.dob = d;
  }

  if (body.licenseExpiry) {
    const d = new Date(body.licenseExpiry);
    if (!Number.isNaN(d.getTime())) payload.licenseExpiry = d;
  }

  return payload;
}

async function ensureUnique(email, phone) {
  if (email) {
    const [userExists, stockistExists] = await Promise.all([
      User.findOne({ email }).lean(),
      Stockist.findOne({ email }).lean(),
    ]);
    if (userExists || stockistExists) {
      throw new Error("Email already in use");
    }
  }

  if (phone) {
    const [userExistsByPhone, stockistExistsByPhone] = await Promise.all([
      User.findOne({ contactNo: phone }).lean(),
      Stockist.findOne({ phone }).lean(),
    ]);
    if (userExistsByPhone || stockistExistsByPhone) {
      throw new Error("Phone number already in use");
    }
  }
}

exports.getStockists = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(1000, Math.max(1, parseInt(limit, 10) || 10));

    const isAdmin = req.user && req.user.role === "admin";
    const filter = isAdmin ? {} : { approved: true, status: "approved" };
    const projection = isAdmin
      ? "name contactPerson phone email address status approved declined approvedAt companies createdAt updatedAt"
      : "name contactPerson phone address.city address.state status approved companies createdAt updatedAt";

    const totalStockists = await Stockist.countDocuments(filter);
    const data = await Stockist.find(filter)
      .select(projection)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalStockists / limit),
      totalStockists,
      count: data.length,
      data,
      debugVersion: "v1.0.3-linkage-fix",
    });
  } catch (err) {
    require('fs').writeFileSync('errlog.txt', String(err.stack || err.message));
    console.error("DEBUG list stockists err: ", err);
    return res.status(500).json({ success: false, message: "Failed to fetch stockists" });
  }
};

// GET /api/stockist/by-medicine?name=paracetamol
// Returns approved stockists whose medicines[] contains the search term.
// Falls back to all approved stockists if no specific inventory match found
// unless strict=true is passed.
exports.searchByMedicine = async (req, res) => {
  try {
    const rawName = String(req.query.name || "").trim();
    const strict = String(req.query.strict || "").toLowerCase() === "true";
    if (!rawName) {
      return res.status(400).json({ success: false, message: "name query parameter is required" });
    }

    const queryKey = normalizeMedicineKey(rawName);
    const approvedStockists = await Stockist.find({
      status: "approved",
      approved: true,
    })
      .select("name contactPerson phone cntxNumber email address.city address.state medicines availableItems")
      .lean();

    const exactMatches = approvedStockists.filter((stockist) => {
      const medNames = extractStockistMedicineNames(stockist);
      return medNames.some((name) => normalizeMedicineKey(name) === queryKey);
    });

    if (exactMatches.length > 0) {
      return res.json({ success: true, count: exactMatches.length, data: exactMatches, matchType: "inventory" });
    }

    if (strict) {
      return res.json({ success: true, count: 0, data: [], matchType: "inventory" });
    }

    return res.json({ success: true, count: approvedStockists.length, data: approvedStockists, matchType: "general" });
  } catch (err) {
    console.error("searchByMedicine error:", err);
    return res.status(500).json({ success: false, message: "Search failed" });
  }
};

exports.uploadLicenseImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file, "stockist/licenses");
    return res.status(200).json({ success: true, url: result.url, public_id: result.public_id });
  } catch (err) {
    return res.status(500).json({ success: false, message: "License upload failed" });
  }
};

exports.uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file, "stockist/profile");
    return res.status(200).json({ success: true, url: result.url, public_id: result.public_id });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Profile upload failed" });
  }
};

exports.createStockist = async (req, res) => {
  try {
    const payload = buildStockistPayload(req.body || {});
    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Stockist name is required." });
    }

    await ensureUnique(payload.email, payload.phone);

    if (req.body.password) {
      payload.password = await bcrypt.hash(String(req.body.password), 12);
    }

    payload.status = "processing";
    payload.approved = false;
    payload.declined = false;

    const stockist = await Stockist.create(payload);
    return res.status(201).json({ success: true, data: sanitizeStockist(stockist) });
  } catch (err) {
    if (String(err.message || "").includes("already in use")) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Failed to create stockist" });
  }
};

exports.registerStockist = async (req, res) => {
  try {
    const payload = buildStockistPayload(req.body || {});
    if (!payload.name) {
      return res.status(400).json({ success: false, message: "Stockist name is required." });
    }

    await ensureUnique(payload.email, payload.phone);

    if (req.body.password) {
      payload.password = await bcrypt.hash(String(req.body.password), 12);
    }

    if (req.files) {
      if (req.files.profileImage && req.files.profileImage[0]) {
        const profileUpload = await uploadToCloudinary(req.files.profileImage[0], "stockist/profile");
        payload.profileImageUrl = profileUpload.url;
      }
      if (req.files.drugLicenseImage && req.files.drugLicenseImage[0]) {
        const licenseUpload = await uploadToCloudinary(req.files.drugLicenseImage[0], "stockist/licenses");
        payload.licenseImageUrl = licenseUpload.url;
      }
    }

    payload.status = "processing";
    payload.approved = false;
    payload.declined = false;

    const stockist = await Stockist.create(payload);
    const tokenPayload = buildTokenPayload(stockist, "stockist");

    return res.status(201).json({
      success: true,
      data: sanitizeStockist(stockist),
      accessToken: issueAccessToken(tokenPayload),
      refreshToken: issueRefreshToken(tokenPayload),
    });
  } catch (err) {
    if (String(err.message || "").includes("already in use")) {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error("Stockist registration failed:", err);
    return res.status(500).json({ success: false, message: "Failed to register stockist" });
  }
};

exports.verifyStockistPassword = async (req, res) => {
  try {
    const { id, password } = req.body || {};
    if (!id || !password || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "id and password are required" });
    }

    const stockist = await Stockist.findById(id).select("+password");
    if (!stockist || !stockist.password) {
      return res.status(404).json({ success: false, message: "Stockist not found" });
    }

    const match = await bcrypt.compare(String(password), String(stockist.password));
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    return res.status(200).json({
      success: true,
      data: {
        _id: stockist._id,
        name: stockist.name,
        contactPerson: stockist.contactPerson,
        phone: stockist.phone,
        email: stockist.email,
        address: stockist.address || {},
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Password verification failed" });
  }
};

exports.getStockistById = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Stockist id required" });
    }

    const stockist = await Stockist.findById(id)
      .select("name contactPerson phone email address profileImageUrl licenseImageUrl roleType status approved declined approvedAt companies createdAt updatedAt")
      .lean();

    if (!stockist) {
      return res.status(404).json({ success: false, message: "Stockist not found" });
    }

    return res.status(200).json({ success: true, data: stockist });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch stockist" });
  }
};

exports.approveStockist = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Stockist id required" });
    }

    const stockist = await Stockist.findById(id);
    if (!stockist) {
      return res.status(404).json({ success: false, message: "Stockist not found" });
    }

    stockist.approved = true;
    stockist.declined = false;
    stockist.status = "approved";
    stockist.approvedAt = new Date();
    stockist.approvedBy = String(req.user._id);
    await stockist.save();

    return res.json({ success: true, message: "Stockist approved", data: sanitizeStockist(stockist) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to approve stockist" });
  }
};

exports.declineStockist = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Stockist id required" });
    }

    const stockist = await Stockist.findById(id);
    if (!stockist) {
      return res.status(404).json({ success: false, message: "Stockist not found" });
    }

    stockist.declined = true;
    stockist.approved = false;
    stockist.status = "declined";
    stockist.declinedAt = new Date();
    await stockist.save();

    return res.json({ success: true, message: "Stockist declined", data: sanitizeStockist(stockist) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to decline stockist" });
  }
};
