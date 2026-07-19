const express = require("express");
const { authenticate } = require("../middleware/auth");
const { paymentLimiter } = require("../middleware/rateLimiters");
const { createOrder, verify, webhook } = require("../controllers/paymentController");

const router = express.Router();

// Raw body needed for webhook signature verification
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body.toString("utf8");
    next();
  },
  webhook
);

router.post("/create-order", authenticate, paymentLimiter, createOrder);
router.post("/verify", authenticate, paymentLimiter, verify);

module.exports = router;
