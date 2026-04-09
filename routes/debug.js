const express = require("express");
const router = express.Router();
const cache = require("../utils/cache");

// Simple debug endpoints. Disabled in production unless DEBUG_API=1.
const isDebugEnabled = () => {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEBUG_API === "1";
};

router.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "Debug endpoint available",
    debug: isDebugEnabled(),
  });
});

// Clear the stockists list cache key. Call this on the instance you
// believe holds a stale cache. Requires debug enabled in production.
router.get("/clear-cache", async (req, res) => {
  try {
    if (!isDebugEnabled()) {
      return res
        .status(403)
        .json({ success: false, message: "Debug endpoints are disabled" });
    }

    const key = "stockists:all";
    const ok = await cache.del(key);
    return res.json({
      success: true,
      message: "Cache cleared",
      key,
      deleted: !!ok,
    });
  } catch (err) {
    console.error("debug/clear-cache error:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: err && err.message ? err.message : String(err),
      });
  }
});

module.exports = router;
