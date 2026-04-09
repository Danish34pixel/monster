const Staff = require("../models/Staff");
const mongoose = require("mongoose");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../config/cloudinary");
const fs = require("fs");

// Create staff with image and aadharCard (uploads to Cloudinary)
exports.createStaff = async (req, res) => {
  try {
    const { fullName, address, contact, email } = req.body;

    // auth: ensure user is authenticated and has stockist role (or admin)
    const reqUser = req.user;
    if (!reqUser) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required." });
    }

    // Only stockists or admins may create staff.
    const isAuthorizedRole =
      (reqUser && (reqUser.role === "stockist" || reqUser.role === "admin")) ||
      (reqUser &&
        reqUser.constructor &&
        reqUser.constructor.modelName === "Stockist");
        
    if (!isAuthorizedRole) {
      return res.status(403).json({
        success: false,
        message: "Only stockists or admins can create staff.",
      });
    }

    if (!req.files || !req.files["image"] || !req.files["aadharCard"]) {
      return res.status(400).json({
        success: false,
        message: "Image and Aadhar card are required.",
      });
    }

    // Upload files to Cloudinary
    const imageFile = req.files["image"][0];
    const aadharFile = req.files["aadharCard"][0];

    const uploadedImage = await uploadToCloudinary(imageFile, "medtek/staff");
    const uploadedAadhar = await uploadToCloudinary(aadharFile, "medtek/staff");

    // Remove local temp files (best-effort)
    try {
      if (imageFile && imageFile.path) fs.unlinkSync(imageFile.path);
      if (aadharFile && aadharFile.path) fs.unlinkSync(aadharFile.path);
    } catch (e) {
      console.warn("Failed to delete temp files:", e);
    }

    // The owning stockist: if admin, use the provided stockist id, otherwise use current user
    let owningStockistId = reqUser._id;
    if (reqUser.role === "admin" && req.body.stockist) {
      owningStockistId = req.body.stockist;
    }

    const staff = new Staff({
      fullName,
      address,
      contact,
      email,
      image: uploadedImage.url,
      aadharCard: uploadedAadhar.url,
      imagePublicId: uploadedImage.public_id,
      aadharPublicId: uploadedAadhar.public_id,
      // record ownership (stockist user creating the staff or admin-specified stockist)
      stockist: owningStockistId,
    });

    await staff.save();
    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    console.error("staffController.createStaff error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStaffs = async (req, res) => {
  try {
    // If query ?stockist=true or ?stockist=<id> passed, limit to that stockist
    const q = req.query || {};
    const filter = {};
    if (q.stockist) {
      // allow 'me' to mean current authenticated stockist
      if (q.stockist === "me") {
        if (req.user) {
          filter.stockist = req.user._id;
        } else {
          // If 'me' requested but no user, return empty list or error instead of crashing
          return res.json({ success: true, data: [] });
        }
      } else {
        // Validate that q.stockist is a valid ObjectId string
        if (mongoose.Types.ObjectId.isValid(q.stockist)) {
          filter.stockist = q.stockist;
        } else {
          // If invalid ID passed, return empty instead of 500
          console.warn(`getStaffs: invalid stockist ID passed: ${q.stockist}`);
          return res.json({ success: true, data: [] });
        }
      }
    }

    // Ensure MongoDB connection is available
    try {
      if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        console.error(
          "getStaffs: MongoDB not connected, readyState=",
          mongoose.connection && mongoose.connection.readyState
        );
        return res
          .status(503)
          .json({ success: false, message: "Database unavailable" });
      }
    } catch (e) {
      console.error("getStaffs: connection check failed", e && e.message);
    }

    console.debug("getStaffs -> filter", filter, "query", q);
    const data = await Staff.find(filter).sort({ createdAt: -1 }).lean().exec();
    res.json({ success: true, data });
  } catch (err) {
    console.error("getStaffs error:", err && err.stack ? err.stack : err);
    // If DEBUG_API is enabled the global error handler will include stack.
    res
      .status(500)
      .json({ success: false, message: "Failed to load staff list" });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const staff = await Staff.findById(id);
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff not found." });
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const staff = await Staff.findById(id);
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff not found." });

    // Authorization: allow deletion if user is admin or the owning stockist
    const reqUser = req.user;
    if (!reqUser) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required." });
    }

    const isOwner =
      staff.stockist && String(staff.stockist) === String(reqUser._id);
    if (reqUser.role !== "admin" && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this staff.",
      });
    }

    // proceed to delete
    await Staff.findByIdAndDelete(id);

    // Remove images from Cloudinary if public ids exist
    try {
      if (staff.imagePublicId) await deleteFromCloudinary(staff.imagePublicId);
      if (staff.aadharPublicId)
        await deleteFromCloudinary(staff.aadharPublicId);
    } catch (e) {
      console.warn("Failed to delete images from Cloudinary:", e);
    }

    res.json({ success: true, message: "Staff deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
