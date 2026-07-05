const rateLimit = require("express-rate-limit");

const jsonRateLimitHandler = (message) => (req, res) =>
  res.status(429).json({
    success: false,
    message,
  });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many authentication attempts. Please try again later."),
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PASSWORD_RESET_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many password reset attempts. Please try again later."),
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.REFRESH_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many token refresh attempts. Please try again later."),
});

// Prevent rapid-fire accept hammering; 10 attempts per minute per IP is
// generous for legitimate one-tap use but blocks script loops.
const acceptLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.ACCEPT_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many accept attempts. Please slow down."),
});

module.exports = {
  authLimiter,
  passwordResetLimiter,
  refreshLimiter,
  acceptLimiter,
};
