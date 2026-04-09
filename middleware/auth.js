const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const { verifyAccessToken } = require("../utils/tokenService");

async function resolveUserFromToken(decoded) {
  const { userId, role } = decoded;
  if (!userId) return null;

  if (role === "stockist") {
    const stockist = await Stockist.findById(userId).select("-password -resetPasswordToken -resetPasswordExpires");
    if (!stockist) return null;
    const obj = stockist.toObject();
    obj.role = "stockist";
    return obj;
  }

  if (role === "purchaser") {
    const purchaser = await Purchaser.findById(userId).select("-password -resetPasswordToken -resetPasswordExpires");
    if (!purchaser) return null;
    const obj = purchaser.toObject();
    obj.role = "purchaser";
    return obj;
  }

  const user = await User.findById(userId).select("-password -resetPasswordToken -resetPasswordExpires");
  if (!user) return null;
  const obj = user.toObject();
  obj.role = obj.role || "user";
  return obj;
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
    const decoded = verifyAccessToken(token);
    const user = await resolveUserFromToken(decoded);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    req.user = user;
    req.auth = decoded;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired." });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid token." });
    }
    return res.status(500).json({ success: false, message: "Token verification failed." });
  }
};

const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }
  return next();
};

module.exports = {
  authenticate,
  isAdmin,
};
