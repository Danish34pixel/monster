const Staff = require("../models/Staff");
const Stockist = require("../models/Stockist");
const User = require("../models/User");
const mongoose = require("mongoose");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../config/cloudinary");
const fs = require("fs");

function toSafeStaff(staff) {
  return {
    _id: staff._id,
    fullName: staff.fullName,
    contact: staff.contact,
    email: staff.email,
    image: staff.image,
    workForType: staff.workForType,
    workForId: staff.workForId,
    workForName: staff.workForName,
    approvalStatus: staff.approvalStatus,
    approved: staff.approved,
    approvedAt: staff.approvedAt,
    currentWorkingPlace: staff.currentWorkingPlace,
    isFresher: staff.isFresher,
    stockist: staff.stockist,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
}

async function resolveWorkplace(body = {}, reqUser = null) {
  const workForTypeRaw = body.workForType || body.worksUnderType;
  const workForNameRaw = body.workForName || body.worksUnderName;
  const workForType = String(workForTypeRaw || "").trim().toLowerCase();
  const normalizedType = workForType === "retailer" ? "medical" : workForType;
  const workForName = String(workForNameRaw || "").trim();
  const rawId = body.workForId || body.workFor || body.stockist;
  let workForId = rawId && mongoose.Types.ObjectId.isValid(rawId) ? rawId : undefined;

  if (!["stockist", "medical"].includes(normalizedType)) {
    throw new Error("Please select whether you work for a stockist or medical store.");
  }
  if (!workForName) {
    throw new Error("Please enter the stockist/medical name.");
  }

  if (reqUser && reqUser.role === "stockist") {
    return {
      workForType: "stockist",
      workForId: reqUser._id,
      workForName: reqUser.name || reqUser.contactPerson || workForName,
      stockist: reqUser._id,
    };
  }

  if (!workForId) {
    if (normalizedType === "stockist") {
      const stockist = await Stockist.findOne({
        name: { $regex: `^${workForName}$`, $options: "i" },
      })
        .select("_id name")
        .lean();
      if (stockist) workForId = stockist._id;
    } else {
      const medical = await User.findOne({
        medicalName: { $regex: `^${workForName}$`, $options: "i" },
      })
        .select("_id medicalName")
        .lean();
      if (medical) workForId = medical._id;
    }
  }

  if (!workForId) {
    throw new Error(
      normalizedType === "stockist"
        ? "Selected wholesaler was not found. Please enter a valid stockist name."
        : "Selected retailer was not found. Please enter a valid medical name."
    );
  }

  if (workForId && normalizedType === "stockist" && !mongoose.Types.ObjectId.isValid(workForId)) {
    throw new Error("Invalid stockist selection.");
  }

  return {
    workForType: normalizedType,
    workForId,
    workForName,
    stockist: normalizedType === "stockist" ? workForId : undefined,
  };
}

exports.createStaff = async (req, res) => {
  try {
    const {
      fullName,
      address,
      contact,
      email,
      currentWorkingPlace,
      isFresher,
      password,
    } = req.body;
    const reqUser = req.user;

    if (!reqUser) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const isAuthorizedRole = reqUser.role === "stockist" || reqUser.role === "admin";
    if (!isAuthorizedRole) {
      return res.status(403).json({ 
        success: false, 
        message: `Your current role (${reqUser.role}) is not authorized to manage staff. Only stockists and admins can use this administrative endpoint.` 
      });
    }

    const normalizedEmail = email ? String(email).toLowerCase().trim() : undefined;
    if (normalizedEmail) {
      const existing = await Staff.findOne({ email: normalizedEmail }).lean();
      if (existing) {
        return res.status(409).json({ success: false, message: "Email already registered" });
      }
    }

    if (!req.files || !req.files.image || !req.files.aadharCard) {
      return res.status(400).json({ success: false, message: "Image and Aadhar card are required." });
    }

    const imageFile = req.files.image[0];
    const aadharFile = req.files.aadharCard[0];

    const [uploadedImage, uploadedAadhar] = await Promise.all([
      uploadToCloudinary(imageFile, "medtek/staff"),
      uploadToCloudinary(aadharFile, "medtek/staff"),
    ]);

    try {
      if (imageFile?.path) fs.unlinkSync(imageFile.path);
      if (aadharFile?.path) fs.unlinkSync(aadharFile.path);
    } catch (e) {
      // best effort cleanup
    }

    let hashedPassword;
    if (password) {
      const bcrypt = require("bcryptjs");
      hashedPassword = await bcrypt.hash(password, 12);
    }

    const workplace = await resolveWorkplace(req.body, reqUser);

    const staff = await Staff.create({
      fullName,
      address,
      contact,
      email: normalizedEmail,
      image: uploadedImage.url,
      aadharCard: uploadedAadhar.url,
      imagePublicId: uploadedImage.public_id,
      aadharPublicId: uploadedAadhar.public_id,
      currentWorkingPlace,
      isFresher: isFresher === "true" || isFresher === true,
      password: hashedPassword,
      approved: true,
      approvalStatus: "approved",
      ...workplace,
    });

    return res.status(201).json({ success: true, data: toSafeStaff(staff) });
  } catch (err) {
    const msg = String(err.message || "");
    if (
      msg.includes("Please select") ||
      msg.includes("Please enter") ||
      msg.includes("Please provide") ||
      msg.includes("not found") ||
      msg.includes("Invalid")
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Failed to create staff" });
  }
};

exports.getStaffs = async (req, res) => {
  try {
    const user = req.user;
    if (!user || !["admin", "stockist", "user"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const q = req.query || {};
    const filter = {};

    if (user.role === "stockist") {
      filter.stockist = user._id;
    } else if (user.role === "user") {
      filter.workForType = "medical";
      filter.workForId = user._id;
    } else if (q.stockist === "me") {
      filter.stockist = user._id;
    } else if (q.stockist && mongoose.Types.ObjectId.isValid(q.stockist)) {
      filter.stockist = q.stockist;
    }

    if (q.approvalStatus && ["pending", "approved", "declined"].includes(q.approvalStatus)) {
      filter.approvalStatus = q.approvalStatus;
    }

    const data = await Staff.find(filter)
      .select(
        "fullName contact email image stockist workForType workForId workForName approvalStatus approved currentWorkingPlace isFresher createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to load staff list" });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id).select(
      "fullName contact email image stockist workForType workForId workForName approvalStatus approved approvedAt currentWorkingPlace isFresher createdAt updatedAt"
    );
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = staff.stockist && String(staff.stockist) === String(req.user._id);
    const isSelf = String(staff._id) === String(req.user._id);
    const isMedicalApprover =
      staff.workForType === "medical" && staff.workForId && String(staff.workForId) === String(req.user._id);
    if (!isAdmin && !isOwner && !isSelf && !isMedicalApprover) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    return res.json({ success: true, data: toSafeStaff(staff) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch staff" });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = staff.stockist && String(staff.stockist) === String(req.user._id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this staff." });
    }

    await Staff.findByIdAndDelete(req.params.id);

    try {
      if (staff.imagePublicId) await deleteFromCloudinary(staff.imagePublicId);
      if (staff.aadharPublicId) await deleteFromCloudinary(staff.aadharPublicId);
    } catch (e) {
      // cloudinary cleanup best effort
    }

    return res.json({ success: true, message: "Staff deleted." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete staff" });
  }
};

exports.getPendingApprovals = async (req, res) => {
  try {
    if (!req.user || !["stockist", "user", "admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const filter = { approvalStatus: "pending" };

    if (req.user.role === "stockist") {
      filter.workForType = "stockist";
      filter.workForId = req.user._id;
    } else if (req.user.role === "user") {
      filter.workForType = "medical";
      filter.workForId = req.user._id;
    }

    const data = await Staff.find(filter)
      .select("fullName contact email image workForType workForId workForName approvalStatus currentWorkingPlace createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to load pending approvals" });
  }
};

exports.approveStaff = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    const isAdmin = req.user.role === "admin";
    const isStockistApprover =
      req.user.role === "stockist" &&
      staff.workForType === "stockist" &&
      String(staff.workForId) === String(req.user._id);
    const isMedicalApprover =
      req.user.role === "user" &&
      staff.workForType === "medical" &&
      String(staff.workForId) === String(req.user._id);

    if (!isAdmin && !isStockistApprover && !isMedicalApprover) {
      return res.status(403).json({ success: false, message: "Not authorized to approve this staff." });
    }

    staff.approvalStatus = "approved";
    staff.approved = true;
    staff.approvedAt = new Date();
    staff.approvedBy = req.user._id;
    staff.declinedAt = undefined;
    staff.declinedBy = undefined;
    await staff.save();

    return res.json({ success: true, message: "Staff approved successfully.", data: toSafeStaff(staff) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to approve staff" });
  }
};

exports.declineStaff = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    const isAdmin = req.user.role === "admin";
    const isStockistApprover =
      req.user.role === "stockist" &&
      staff.workForType === "stockist" &&
      String(staff.workForId) === String(req.user._id);
    const isMedicalApprover =
      req.user.role === "user" &&
      staff.workForType === "medical" &&
      String(staff.workForId) === String(req.user._id);

    if (!isAdmin && !isStockistApprover && !isMedicalApprover) {
      return res.status(403).json({ success: false, message: "Not authorized to decline this staff." });
    }

    staff.approvalStatus = "declined";
    staff.approved = false;
    staff.declinedAt = new Date();
    staff.declinedBy = req.user._id;
    await staff.save();

    return res.json({ success: true, message: "Staff declined.", data: toSafeStaff(staff) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to decline staff" });
  }
};
