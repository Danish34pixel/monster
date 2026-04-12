const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const Purchaser = require("../models/Purchaser");
const PurchaseCardRequest = require("../models/PurchaseCardRequest");
const { authenticate } = require("../middleware/auth");
const { sendMail } = require("../utils/mailer");
const { verifyAccessToken } = require("../utils/tokenService");

// In-memory SSE clients registry: stockistId -> array of response objects
const sseClients = new Map();

// POST /api/purchasing-card/request
// Body: { stockistIds: [id1, id2, id3] }
// Creates a request, requires at least 3 stockists, notifies them by email
router.post("/request", authenticate, async (req, res) => {
  try {
    const requester = req.user;
    if (!requester)
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });

    console.debug("Purchasing-card request by:", {
      requesterId: requester && requester._id,
      email: requester && requester.email,
    });
    const {
      stockistIds,
      purchaserId,
      requester: requesterBody,
      purchaserData,
    } = req.body || {};
    // If purchaserId is provided, we store a display reference so stockists see the correct name
    if (!Array.isArray(stockistIds) || stockistIds.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Please select at least 3 stockists",
      });
    }

    // Validate stockists exist
    const stockists = await Stockist.find({ _id: { $in: stockistIds } }).lean();
    if (!stockists || stockists.length < 3) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid stockist selection" });
    }

    // Create request and generate per-stockist approval tokens
    const crypto = require("crypto");
    const approvalTokens = stockistIds.map((sid) => ({
      stockist: sid,
      token: crypto.randomBytes(18).toString("hex"),
      used: false,
    }));

    const reqDoc = new PurchaseCardRequest({
      requester: requester._id,
      stockists: stockistIds,
      approvalTokens,
      requesterDisplay: purchaserId
        ? {
            name: requesterBody?.fullName || undefined,
            email: requesterBody?.email || undefined,
            purchaserId,
            photo: purchaserData?.photo || undefined,
          }
        : requesterBody
        ? { name: requesterBody.fullName, email: requesterBody.email }
        : undefined,
    });
    await reqDoc.save();

    // Broadcast to any connected SSE clients for the selected stockists
    try {
      broadcastNewRequest(reqDoc);
    } catch (e) {
      console.warn(
        "Failed to broadcast new purchasing request",
        e && e.message
      );
    }

    console.debug("PurchaseCardRequest saved:", { id: reqDoc._id });

    // Mark user session as requested for quick UI feedback
    if (requester && typeof requester.save === "function") {
      requester.purchasingCardRequested = true;
      try {
        await requester.save();
      } catch (saveErr) {
        console.warn("Failed to update requester requested flag:", saveErr.message);
      }
    }

    // Notify selected stockists via email (best-effort). Do not await each
    // sendMail serially to avoid long blocking operations; run them and
    // catch errors so promise rejections don't escape.
    for (const s of stockists) {
      if (!s || !s.email) continue;
      try {
        const tokenObj = reqDoc.approvalTokens.find(
          (t) => String(t.stockist) === String(s._id)
        );
        const approveLink = tokenObj
          ? `${
              process.env.FRONTEND_URL || "http://localhost:5173"
            }/approve?token=${tokenObj.token}`
          : `${process.env.FRONTEND_URL || "http://localhost:5173"}/`;

        // fire-and-forget with explicit catch
        sendMail({
          to: s.email,
          subject: "Purchasing Card Approval Request",
          html: `<p>Hello ${s.name || s.contactPerson || "Stockist"},</p>
                  <p>${
                    requester.medicalName || requester.fullName || requester.email
                  } has requested a Purchasing Card and selected you as a verifier. You may approve the request by clicking the button below.</p>
                  <p><a href="${approveLink}" style="display:inline-block;padding:10px 14px;background:#0ea5a4;color:white;border-radius:6px;text-decoration:none">Approve Request</a></p>
                  <p>Request ID: ${reqDoc._id}</p>`,
        }).catch((mailErr) => {
          console.warn(
            "Failed to notify stockist (async):",
            s._id,
            mailErr && mailErr.message
          );
        });
      } catch (mailErr) {
        console.warn(
          "Failed to schedule notification for stockist",
          s && s._id,
          mailErr && mailErr.message
        );
      }
    }

    return res.json({
      success: true,
      message: "Request submitted and stockists notified",
      requestId: reqDoc._id,
    });
  } catch (err) {
    console.error("Purchasing card request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SSE endpoint: clients can connect and listen for new requests targeted to them
// Client should connect with ?token=<jwt> where token is the stockist's auth token
router.get("/stream", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send("Missing token");
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (e) {
      return res.status(401).send("Invalid token");
    }

    const stockistId = decoded.userId;
    if (!stockistId) return res.status(401).send("Invalid token payload");

    // Set SSE headers
    const origin = req.headers.origin;
    const allowedOrigins = Array.isArray(global.__ALLOWED_ORIGINS__)
      ? global.__ALLOWED_ORIGINS__
      : [];
    const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : null;
    if (!allowOrigin) {
      return res.status(403).send("Origin not allowed");
    }

    res.writeHead(200, {
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream",
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Credentials": "true",
    });

    // Send initial comment
    res.write(`: connected\n\n`);

    // Register client
    const arr = sseClients.get(String(stockistId)) || [];
    arr.push(res);
    sseClients.set(String(stockistId), arr);

    // Clean up on close
    req.on("close", () => {
      const clients = sseClients.get(String(stockistId)) || [];
      sseClients.set(
        String(stockistId),
        clients.filter((r) => r !== res)
      );
    });
  } catch (e) {
    console.error("SSE stream error", e && e.message);
    try {
      res.status(500).end();
    } catch (e) {}
  }
});

// Helper: broadcast a new request doc to connected stockist clients
const broadcastNewRequest = (reqDoc) => {
  try {
    if (!reqDoc || !Array.isArray(reqDoc.stockists)) return;
    for (const sid of reqDoc.stockists) {
      const clients = sseClients.get(String(sid)) || [];
      for (const res of clients) {
        try {
          res.write(`event: newRequest\n`);
          res.write(`data: ${JSON.stringify(reqDoc)}\n\n`);
        } catch (e) {
          // ignore write errors
        }
      }
    }
  } catch (e) {
    console.error("broadcastNewRequest error", e && e.message);
  }
};

// GET /api/purchasing-card/requests - stockist (authenticated) can list pending requests including those where they are listed
router.get("/requests", authenticate, async (req, res) => {
  try {
    const user = req.user;
    // Resolve stockist robustly: token may already have resolved a Stockist
    // document or `req.user` may be a User that maps to a Stockist by email.
    let stockist = null;
    try {
      if (user && user.role === "stockist") {
        stockist = await Stockist.findById(user._id);
      }
      if (!stockist && user && user.email) {
        stockist = await Stockist.findOne({
          email: String(user.email).toLowerCase(),
        });
      }
      if (!stockist && user && user._id) {
        stockist = await Stockist.findById(user._id);
      }
    } catch (e) {
      stockist = null;
    }

    if (!stockist)
      return res.status(403).json({
        success: false,
        message: "Only stockists can list approval requests",
      });

    console.debug("Listing requests for stockist", {
      stockistId: stockist._id,
    });

    // Only return requests that are pending and have NOT been approved by
    // the authenticated stockist. Use $not + $elemMatch to ensure we exclude
    // any document where approvals array contains an entry for this stockist.
    const requests = await PurchaseCardRequest.find({
      stockists: stockist._id,
      status: "pending",
      approvals: { $not: { $elemMatch: { stockist: stockist._id } } },
    })
      .populate("requester", "medicalName email")
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: requests });
  } catch (err) {
    console.error("List requests error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/purchasing-card/approve/:requestId - stockist approves the request
router.post("/approve/:requestId", authenticate, async (req, res) => {
  try {
    const user = req.user;
    // Resolve stockist reliably like in the listing route
    let stockist = null;
    try {
      if (user && user.role === "stockist") {
        stockist = await Stockist.findById(user._id);
      }
      if (!stockist && user && user.email) {
        stockist = await Stockist.findOne({
          email: String(user.email).toLowerCase(),
        });
      }
      if (!stockist && user && user._id) {
        stockist = await Stockist.findById(user._id);
      }
    } catch (e) {
      stockist = null;
    }

    if (!stockist)
      return res.status(403).json({
        success: false,
        message: "Only stockists can approve requests",
      });

    const { requestId } = req.params;
    const reqDoc = await PurchaseCardRequest.findById(requestId);
    if (!reqDoc)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    if (reqDoc.status !== "pending")
      return res
        .status(400)
        .json({ success: false, message: "Request no longer pending" });

    // If stockist already approved, ignore
    if (
      reqDoc.approvals.some((a) => String(a.stockist) === String(stockist._id))
    ) {
      return res.json({ success: true, message: "Already approved" });
    }

    // Record approval
    reqDoc.approvals.push({ stockist: stockist._id, approvedAt: new Date() });

    // If approvals reach 3, mark approved and grant purchasing card to requester
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      reqDoc.approvedAt = new Date();
      await reqDoc.save();

      // Grant card to User if linked
      const userDoc = await User.findById(reqDoc.requester);
      if (userDoc) {
        userDoc.hasPurchasingCard = true;
        userDoc.purchasingCardRequested = false;
        await userDoc.save();
      }

      // Also mark the Purchaser document as approved if purchaserId is stored
      try {
        const pId = reqDoc.requesterDisplay && reqDoc.requesterDisplay.purchaserId;
        if (pId) {
          await Purchaser.findByIdAndUpdate(pId, { approved: true, verified: true });
          console.debug("Purchaser approved:", pId);
        }
      } catch (e) {
        console.warn("Could not mark Purchaser approved:", e && e.message);
      }

      console.debug("Request approved (threshold reached)", {
        requestId: reqDoc._id,
        approvals: reqDoc.approvals.length,
      });

      return res.json({
        success: true,
        message: "Request approved and purchaser granted",
        approvals: reqDoc.approvals.length,
      });
    }

    await reqDoc.save();

    console.debug("Approval recorded", {
      requestId: reqDoc._id,
      approvals: reqDoc.approvals.length,
      stockist: stockist._id,
    });

    return res.json({
      success: true,
      message: "Approval recorded",
      approvals: reqDoc.approvals.length,
    });
  } catch (err) {
    console.error("Approve request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Public status endpoint to let a requester poll approval progress
// GET /api/purchasing-card/status/:id
router.get("/status/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const reqDoc = await PurchaseCardRequest.findById(id).lean();
    if (!reqDoc)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    const isAdmin = req.user && req.user.role === "admin";
    const isRequester =
      reqDoc.requester && String(reqDoc.requester) === String(req.user._id);
    const isStockist =
      Array.isArray(reqDoc.stockists) &&
      reqDoc.stockists.some((sid) => String(sid) === String(req.user._id));

    if (!isAdmin && !isRequester && !isStockist) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to view request status" });
    }

    return res.json({
      success: true,
      data: {
        status: reqDoc.status,
        approvals: (reqDoc.approvals || []).length,
      },
    });
  } catch (err) {
    console.error("PurchaseCard status error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/purchasing-card/approve-web?token=...  (public link clicked from email)
router.get("/approve-web", async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).send("Missing token");

    const reqDoc = await PurchaseCardRequest.findOne({
      "approvalTokens.token": token,
    });
    if (!reqDoc)
      return res.status(404).send("Request not found or token invalid");
    if (reqDoc.status !== "pending")
      return res.status(400).send("Request not pending");

    // Find the token entry
    const tEntry = reqDoc.approvalTokens.find(
      (t) => t.token === token && !t.used
    );
    if (!tEntry) return res.status(400).send("Token already used or invalid");

    // mark token used
    tEntry.used = true;
    reqDoc.approvals.push({
      stockist: tEntry.stockist,
      approvedAt: new Date(),
    });

    // If approvals reach 3, mark approved and grant purchasing card
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      reqDoc.approvedAt = new Date();
      await reqDoc.save();

      const userDoc = await User.findById(reqDoc.requester);
      if (userDoc) {
        userDoc.hasPurchasingCard = true;
        userDoc.purchasingCardRequested = false;
        await userDoc.save();
      }

      // Also mark the Purchaser document as approved if purchaserId is stored
      try {
        const pId = reqDoc.requesterDisplay && reqDoc.requesterDisplay.purchaserId;
        if (pId) {
          await Purchaser.findByIdAndUpdate(pId, { approved: true, verified: true });
          console.debug("[email-approve] Purchaser approved:", pId);
        }
      } catch (e) {
        console.warn("Could not mark Purchaser approved (email route):", e && e.message);
      }

      // Redirect to a small success page or simply send success
      return res.send(
        "Thank you — request approved and purchasing card granted."
      );
    }

    await reqDoc.save();
    return res.send("Thank you — your approval has been recorded.");
  } catch (err) {
    console.error("Approve-web error:", err);
    return res.status(500).send("Server error");
  }
});

// Ensure all routes are exported (status and approve-web must be included)
module.exports = router;
