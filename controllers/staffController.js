const Staff = require("../models/Staff");
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
    stockist: staff.stockist,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
}

exports.createStaff = async (req, res) => {
  try {
    const { fullName, address, contact, email, currentWorkingPlace, isFresher, password } = req.body;
    const reqUser = req.user;

    if (!reqUser) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const isAuthorizedRole = reqUser.role === "stockist" || reqUser.role === "admin";
    if (!isAuthorizedRole) {
      return res.status(403).json({ success: false, message: "Only stockists or admins can create staff." });
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

    const staff = await Staff.create({
      fullName,
      address,
      contact,
      email: email ? email.toLowerCase() : undefined,
      image: uploadedImage.url,
      aadharCard: uploadedAadhar.url,
      imagePublicId: uploadedImage.public_id,
      aadharPublicId: uploadedAadhar.public_id,
      currentWorkingPlace,
      isFresher: isFresher === 'true' || isFresher === true,
      password: hashedPassword,
      approved: false
    });

    return res.status(201).json({ success: true, data: toSafeStaff(staff) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to create staff" });
  }
};

exports.getStaffs = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};

    if (q.stockist === "me") {
      filter.stockist = req.user._id;
    } else if (q.stockist && mongoose.Types.ObjectId.isValid(q.stockist)) {
      filter.stockist = q.stockist;
    }

    const data = await Staff.find(filter)
      .select("fullName contact email image stockist createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to load staff list" });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id).select("fullName contact email image stockist createdAt updatedAt");
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner = staff.stockist && String(staff.stockist) === String(req.user._id);
    if (!isAdmin && !isOwner) {
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
