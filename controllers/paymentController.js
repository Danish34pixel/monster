const crypto = require("crypto");
const Razorpay = require("razorpay");
const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const { getPlan, isValidPlanKey } = require("../config/subscriptionPlans");
const { logEvent } = require("../utils/eventLog");

let _razorpay;
const getRazorpay = () => {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

async function resolveAccount(userId, role) {
  if (role === "purchaser") {
    const p = await Purchaser.findById(userId);
    return p ? { doc: p, model: "Purchaser" } : null;
  }
  const u = await User.findById(userId);
  return u ? { doc: u, model: "User" } : null;
}

function applySubscription(doc, planKey) {
  const plan = getPlan(planKey);
  const now = new Date();
  doc.subscriptionPlan = planKey;
  doc.subscriptionStartDate = now;
  doc.subscriptionEndDate = new Date(now.getTime() + plan.durationInDays * 86400000);
  doc.planAmount = plan.amount;
  doc.pendingPlanKey = undefined;
  doc.paymentStatus = "paid";
  doc.accountStatus = "pending_admin_verification";
}

// POST /api/payment/create-order
exports.createOrder = async (req, res) => {
  try {
    const { planKey } = req.body;

    if (!planKey || !isValidPlanKey(planKey)) {
      return res.status(400).json({
        success: false,
        message: `Invalid plan. Choose: monthly, quarterly, or yearly`,
      });
    }

    const plan = getPlan(planKey);
    const { _id: userId, role } = req.user;

    const resolved = await resolveAccount(userId, role);
    if (!resolved) return res.status(404).json({ success: false, message: "Account not found" });

    const { doc, model } = resolved;

    // Allow re-purchase for renewal (expired or returning users)
    // Block only if already paid AND subscription still active
    if (
      doc.paymentStatus === "paid" &&
      doc.accountStatus !== "active" // still pending admin — don't block
    ) {
      // Already in pending_admin_verification — no need to re-pay
    }

    // Receipt ≤ 40 chars: "r_" + last 8 of userId + "_" + last 8 of timestamp = 19 chars
    const receipt = `r_${String(userId).slice(-8)}_${Date.now().toString().slice(-8)}`;

    const order = await getRazorpay().orders.create({
      amount: plan.amount,
      currency: "INR",
      receipt,
      notes: { planKey, userId: String(userId), role },
    });

    doc.razorpayOrderId = order.id;
    doc.pendingPlanKey = planKey;
    doc.planAmount = plan.amount;
    await doc.save();

    logEvent(userId, model, "payment_initiated", {
      orderId: order.id,
      amount: plan.amount,
      planKey,
      role,
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: plan.amount,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: { key: planKey, label: plan.label, amount: plan.amount },
    });
  } catch (err) {
    console.error("[payment] create-order error:", err.message, err);
    return res.status(500).json({ success: false, message: "Failed to create payment order" });
  }
};

// POST /api/payment/verify
exports.verify = async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing payment fields" });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const { _id: userId, role } = req.user;
    const resolved = await resolveAccount(userId, role);
    const model = resolved?.model || (role === "purchaser" ? "Purchaser" : "User");

    // Guard against length mismatch before timingSafeEqual
    const expBuf = Buffer.from(expected, "hex");
    const sigBuf = Buffer.from(razorpay_signature, "hex");
    const sigValid =
      expBuf.length === sigBuf.length &&
      crypto.timingSafeEqual(expBuf, sigBuf);

    if (!sigValid) {
      console.warn("[payment] signature mismatch userId:", userId);
      logEvent(userId, model, "payment_failed", {
        reason: "signature_mismatch",
        orderId: razorpay_order_id,
      });
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    if (!resolved) return res.status(404).json({ success: false, message: "Account not found" });
    const { doc } = resolved;

    // Idempotent — skip if already processed by webhook
    if (doc.paymentStatus !== "paid") {
      const planKey = doc.pendingPlanKey || (resolved.doc.razorpayOrderId === razorpay_order_id ? null : null);
      if (planKey) {
        applySubscription(doc, planKey);
      } else {
        doc.paymentStatus = "paid";
        doc.accountStatus = "pending_admin_verification";
      }
      doc.razorpayPaymentId = razorpay_payment_id;
      doc.razorpayOrderId = razorpay_order_id;
      await doc.save();
    }

    logEvent(userId, model, "payment_verified_signature", {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      planKey: doc.subscriptionPlan,
    });

    return res.json({
      success: true,
      message: "Payment verified. Awaiting admin approval.",
      subscriptionPlan: doc.subscriptionPlan,
      subscriptionEndDate: doc.subscriptionEndDate,
    });
  } catch (err) {
    console.error("[payment] verify error:", err.message, err);
    return res.status(500).json({ success: false, message: "Payment verification error" });
  }
};

// POST /api/payment/webhook
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const body = req.rawBody;
    if (!body || !signature) return res.status(400).json({ success: false });

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    const expBuf = Buffer.from(expected, "hex");
    const sigBuf = Buffer.from(signature, "hex");
    if (
      expBuf.length !== sigBuf.length ||
      !crypto.timingSafeEqual(expBuf, sigBuf)
    ) {
      return res.status(400).json({ success: false, message: "Webhook signature invalid" });
    }

    const event = JSON.parse(body);
    if (!["payment.captured", "order.paid"].includes(event.event)) {
      return res.json({ success: true });
    }

    const orderId =
      event.payload?.payment?.entity?.order_id ||
      event.payload?.order?.entity?.id;
    const paymentId = event.payload?.payment?.entity?.id;
    const notePlanKey =
      event.payload?.payment?.entity?.notes?.planKey ||
      event.payload?.order?.entity?.notes?.planKey;

    if (!orderId) return res.json({ success: true });

    let doc = await User.findOne({ razorpayOrderId: orderId });
    let model = "User";
    if (!doc) {
      doc = await Purchaser.findOne({ razorpayOrderId: orderId });
      model = "Purchaser";
    }

    if (!doc) {
      console.warn("[webhook] order not found:", orderId);
      return res.json({ success: true });
    }

    if (doc.paymentStatus !== "paid") {
      const planKey = doc.pendingPlanKey || notePlanKey;
      if (planKey && isValidPlanKey(planKey)) {
        applySubscription(doc, planKey);
      } else {
        doc.paymentStatus = "paid";
        doc.accountStatus = "pending_admin_verification";
      }
      if (paymentId) doc.razorpayPaymentId = paymentId;
      await doc.save();
      logEvent(doc._id, model, "payment_verified_webhook", {
        orderId,
        paymentId,
        planKey: doc.subscriptionPlan,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[payment] webhook error:", err.message, err);
    return res.status(500).json({ success: false });
  }
};
