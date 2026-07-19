const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const Staff = require("../models/Staff");
const { verifyAccessToken } = require("../utils/tokenService");

async function resolveUserFromToken(decoded) {
  const { userId, role } = decoded;
  if (!userId) return null;

  if (role === "stockist") {
    const stockist = await Stockist.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpires",
    );
    if (!stockist) return null;
    const obj = stockist.toObject();
    obj.role = "stockist";
    return obj;
  }

  if (role === "purchaser") {
    const purchaser = await Purchaser.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpires",
    );
    if (!purchaser) return null;
    const obj = purchaser.toObject();
    obj.role = "purchaser";
    return obj;
  }

  if (role === "staff") {
    const staff = await Staff.findById(userId).select(
      "-password -resetPasswordToken -resetPasswordExpires",
    );
    if (!staff) return null;
    const obj = staff.toObject();
    obj.role = "staff";
    return obj;
  }

  const user = await User.findById(userId).select(
    "-password -resetPasswordToken -resetPasswordExpires",
  );
  if (!user) return null;
  const obj = user.toObject();
  obj.role = obj.role || "user";
  return obj;
}

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn(`[auth] 401 NO TOKEN — ${req.method} ${req.path}`);
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (verifyErr) {
      console.warn(`[auth] 401 VERIFY FAIL — ${req.method} ${req.path} — ${verifyErr.name}: ${verifyErr.message} — token prefix: ${token.slice(0, 20)}...`);
      throw verifyErr;
    }
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
      return res
        .status(401)
        .json({ success: false, message: "Token expired." });
    }
    if (error.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ success: false, message: "Invalid token." });
    }
    return res
      .status(500)
      .json({ success: false, message: "Token verification failed." });
  }
};

const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      req.auth = null;
      return next();
    }

    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    const user = await resolveUserFromToken(decoded);
    if (!user) {
      req.user = null;
      req.auth = null;
      return next();
    }

    req.user = user;
    req.auth = decoded;
    return next();
  } catch (error) {
    // Optional auth should not reject public requests on token issues.
    req.user = null;
    req.auth = null;
    return next();
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

const isAdminOrStockist = (req, res, next) => {
  if (!req.user || !["admin", "stockist"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin or stockist privileges required.",
    });
  }
  return next();
};

const SUBSCRIPTION_ROLES = new Set(["medical_owner", "user", "purchaser"]);

const requireActiveAccount = (req, res, next) => {
  if (!req.user) return next();
  if (!SUBSCRIPTION_ROLES.has(req.user.role)) return next();
  const status = req.user.accountStatus;
  if (status && status !== "active") {
    return res.status(403).json({
      success: false,
      message: "Account not yet active.",
      accountStatus: status,
    });
  }
  return next();
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  isAdmin,
  isAdminOrStockist,
  requireActiveAccount,
};
