const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Stockist = require("../models/Stockist");

// Middleware to authenticate JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Debug: log presence of authorization header (redacted)
    try {
      if (authHeader && typeof authHeader === "string") {
        console.debug("authenticate -> authorization header present", {
          preview: authHeader.slice(0, 20) + "...",
        });
      } else {
        console.debug("authenticate -> no authorization header present");
      }
    } catch (e) {}

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Verify token with consistent fallback secret
    const secret = process.env.JWT_SECRET || "supersecretkey";
    const decoded = jwt.verify(token, secret);

    // attach decoded token for downstream use (debugging / alternate checks)
    try {
      req.decoded = decoded;
    } catch (e) {}

    // Try to resolve the token owner. Prefer the role hint in the token if present.
    let user = null;
    try {
      if (decoded && decoded.role && decoded.role === "stockist") {
        user = await Stockist.findById(decoded.userId).select("-password");
      } else if (decoded && decoded.role && decoded.role === "purchaser") {
        const Purchaser = require("../models/Purchaser");
        user = await Purchaser.findById(decoded.userId).select("-password");
      } else {
        // default: look up regular User first
        user = await User.findById(decoded.userId).select("-password");
        // if not found, try Stockist as a fallback (handles tokens issued for stockists)
        if (!user) {
          user = await Stockist.findById(decoded.userId).select("-password");
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

    // Attach user to request object
    // ensure a role is present for stockist docs so downstream role checks work
    try {
      if (user && !user.role) {
        // prefer role from token if present, otherwise default to 'stockist'
        user.role = (decoded && decoded.role) || "stockist";
      }
    } catch (e) {
      // ignore
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

// Middleware to check if user is admin
// Also allow specific emails configured via EXTRA_ADMIN_EMAILS env var
const EXTRA_ADMIN_EMAILS = (process.env.EXTRA_ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isAdmin = (req, res, next) => {
  try {
    // Dev-only bypass: allow if developer includes x-dev-admin header and server not in production
    try {
      const devHeader =
        req.headers["x-dev-admin"] || req.headers["X-Dev-Admin"] || null;
      if (process.env.NODE_ENV !== "production" && devHeader === "1") {
        console.debug("isAdmin: allowed via x-dev-admin header (dev-only)");
        return next();
      }
    } catch (e) {}

    const user = req.user;
    const userEmail = (user && (user.email || user.contactNo || ""))
      .toString()
      .toLowerCase();
    const decodedEmail =
      req.decoded && req.decoded.email
        ? String(req.decoded.email).toLowerCase()
        : null;

    if (user && user.role === "admin") return next();

    // If token itself carries an email matching EXTRA_ADMIN_EMAILS, allow (dev convenience)
    if (decodedEmail && EXTRA_ADMIN_EMAILS.includes(decodedEmail)) {
      console.debug("isAdmin: allowed via decoded token email", {
        decodedEmail,
      });
      return next();
    }

    if (userEmail && EXTRA_ADMIN_EMAILS.includes(userEmail)) return next();

    // Debug log to help diagnose why admin check fails during development.
    try {
      console.debug("isAdmin check failed", {
        resolvedUserEmail: userEmail,
        resolvedUserRole: user && user.role,
        EXTRA_ADMIN_EMAILS,
      });
    } catch (e) {
      // ignore logging errors
    }

    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  } catch (e) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }
};

module.exports = {
  authenticate,
  isAdmin,
};
