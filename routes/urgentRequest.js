const express = require("express");
const router = express.Router();
const UrgentRequest = require("../models/UrgentRequest");
const UrgentRequestMessage = require("../models/UrgentRequestMessage");
const User = require("../models/User");
const Purchaser = require("../models/Purchaser");
const { authenticate } = require("../middleware/auth");
const { acceptLimiter } = require("../middleware/rateLimiters");

const uid = (user) => String(user._id || user.id);

// Medical owners can have role "user" (regular) or "admin"
const isMedicalOwner = (user) => ["user", "admin"].includes(user.role);

// ── Backward-compat shim ──────────────────────────────────────────────────────
// Old documents (pre-multi-item) have flat itemName/quantity/urgencyNote.
// Normalize them into the new items[] shape so all clients see a consistent shape.

function normalizeItems(doc) {
  if (Array.isArray(doc.items) && doc.items.length > 0) return doc;
  return {
    ...doc,
    items: [
      {
        name: doc.itemName || "Unknown item",
        quantity: doc.quantity || 1,
        description: doc.urgencyNote || null,
      },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertAccess(request, req) {
  const callerId = uid(req.user);
  const isOwner =
    String(request.createdBy) === callerId && isMedicalOwner(req.user);
  const isAcceptor =
    request.acceptedBy &&
    String(request.acceptedBy) === callerId &&
    req.user.role === "purchaser";
  return { isOwner, isAcceptor };
}

// ── Medical owner: create request ────────────────────────────────────────────

router.post("/create", authenticate, async (req, res) => {
  try {
    console.log("[UrgentRequest /create] role:", req.user.role, "userId:", uid(req.user));
    if (!isMedicalOwner(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only medical owners can create urgent requests.",
      });
    }

    const { items, urgencyNote } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one item is required.",
      });
    }

    const validated = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const name = String(item.name || "").trim();
      if (!name) {
        return res.status(400).json({
          success: false,
          message: `Item ${i + 1}: name is required.`,
        });
      }
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      validated.push({
        name,
        quantity: qty,
        description: item.description ? String(item.description).trim() : null,
      });
    }

    const request = await UrgentRequest.create({
      createdBy: uid(req.user),
      createdByName: req.user.medicalName || req.user.ownerName || req.user.email,
      items: validated,
      urgencyNote: urgencyNote ? String(urgencyNote).trim() : null,
    });

    return res.status(201).json({ success: true, data: normalizeItems(request.toObject()) });
  } catch (err) {
    console.error("UrgentRequest create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create urgent request." });
  }
});

// ── Medical owner: list own requests ─────────────────────────────────────────

router.get("/mine", authenticate, async (req, res) => {
  try {
    if (!isMedicalOwner(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only medical owners can view their requests.",
      });
    }
    const requests = await UrgentRequest.find({ createdBy: uid(req.user) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const result = await Promise.all(
      requests.map(async (r) => {
        const normalized = normalizeItems(r);
        if (r.status === "accepted" && r.acceptedBy) {
          const purchaser = await Purchaser.findById(r.acceptedBy)
            .select("fullName contactNo")
            .lean();
          return {
            ...normalized,
            purchaserPhone: purchaser?.contactNo || null,
            purchaserName: purchaser?.fullName || r.acceptedByName,
          };
        }
        return normalized;
      })
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("UrgentRequest mine error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch requests." });
  }
});

// ── Purchaser: list all pending requests ─────────────────────────────────────

router.get("/pending", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "purchaser") {
      return res.status(403).json({
        success: false,
        message: "Only purchasers can view pending requests.",
      });
    }
    const requests = await UrgentRequest.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: requests.map(normalizeItems) });
  } catch (err) {
    console.error("UrgentRequest pending error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch pending requests." });
  }
});

// ── Purchaser: combined dashboard poll (pending + accepted in one round-trip) ─

router.get("/dashboard", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "purchaser") {
      return res.status(403).json({
        success: false,
        message: "Only purchasers can access the dashboard.",
      });
    }

    const [pendingRaw, acceptedRaw] = await Promise.all([
      UrgentRequest.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      UrgentRequest.find({
        acceptedBy: uid(req.user),
        status: { $in: ["accepted", "completed", "cancelled"] },
      })
        .sort({ acceptedAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const accepted = await Promise.all(
      acceptedRaw.map(async (r) => {
        const owner = await User.findById(r.createdBy)
          .select("contactNo medicalName ownerName")
          .lean();
        return {
          ...normalizeItems(r),
          ownerPhone: owner?.contactNo || null,
          ownerName: owner?.medicalName || owner?.ownerName || r.createdByName,
        };
      })
    );

    return res.json({
      success: true,
      pending: pendingRaw.map(normalizeItems),
      accepted,
    });
  } catch (err) {
    console.error("UrgentRequest dashboard error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard." });
  }
});

// ── Purchaser: list requests they accepted ────────────────────────────────────

router.get("/accepted", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "purchaser") {
      return res.status(403).json({
        success: false,
        message: "Only purchasers can view their accepted requests.",
      });
    }
    const requests = await UrgentRequest.find({
      acceptedBy: uid(req.user),
      status: { $in: ["accepted", "completed", "cancelled"] },
    })
      .sort({ acceptedAt: -1 })
      .limit(50)
      .lean();

    const result = await Promise.all(
      requests.map(async (r) => {
        const owner = await User.findById(r.createdBy)
          .select("contactNo medicalName ownerName")
          .lean();
        return {
          ...normalizeItems(r),
          ownerPhone: owner?.contactNo || null,
          ownerName: owner?.medicalName || owner?.ownerName || r.createdByName,
        };
      })
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("UrgentRequest accepted error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch accepted requests." });
  }
});

// ── Purchaser: accept a request (atomic, first-wins) ─────────────────────────

router.post("/:id/accept", acceptLimiter, authenticate, async (req, res) => {
  try {
    if (req.user.role !== "purchaser") {
      return res.status(403).json({
        success: false,
        message: "Only purchasers can accept requests.",
      });
    }
    const updated = await UrgentRequest.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      {
        $set: {
          status: "accepted",
          acceptedBy: uid(req.user),
          acceptedByName: req.user.fullName || req.user.email,
          acceptedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: "Request already accepted by someone else.",
      });
    }
    const owner = await User.findById(updated.createdBy)
      .select("contactNo medicalName ownerName")
      .lean();
    return res.json({
      success: true,
      data: normalizeItems(updated.toObject()),
      ownerPhone: owner?.contactNo || null,
      ownerName: owner?.medicalName || owner?.ownerName || updated.createdByName,
    });
  } catch (err) {
    console.error("UrgentRequest accept error:", err);
    return res.status(500).json({ success: false, message: "Failed to accept request." });
  }
});

// ── Medical owner: cancel own pending request ─────────────────────────────────

router.post("/:id/cancel", authenticate, async (req, res) => {
  try {
    if (!isMedicalOwner(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only medical owners can cancel requests.",
      });
    }
    const updated = await UrgentRequest.findOneAndUpdate(
      { _id: req.params.id, createdBy: uid(req.user), status: "pending" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Request not found or already actioned.",
      });
    }
    return res.json({ success: true, data: normalizeItems(updated.toObject()) });
  } catch (err) {
    console.error("UrgentRequest cancel error:", err);
    return res.status(500).json({ success: false, message: "Failed to cancel request." });
  }
});

// ── Get single request details (phone revealed post-acceptance) ───────────────

router.get("/:id", authenticate, async (req, res) => {
  try {
    const request = await UrgentRequest.findById(req.params.id).lean();
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    const { isOwner, isAcceptor } = await assertAccess(request, req);
    if (!isOwner && !isAcceptor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    let result = normalizeItems({ ...request });

    if (request.status === "accepted" || request.status === "completed") {
      if (isOwner && request.acceptedBy) {
        const purchaser = await Purchaser.findById(request.acceptedBy)
          .select("fullName contactNo")
          .lean();
        result.purchaserPhone = purchaser?.contactNo || null;
        result.purchaserName = purchaser?.fullName || request.acceptedByName;
      }
      if (isAcceptor) {
        const owner = await User.findById(request.createdBy)
          .select("contactNo medicalName ownerName")
          .lean();
        result.ownerPhone = owner?.contactNo || null;
        result.ownerName = owner?.medicalName || owner?.ownerName || request.createdByName;
      }
    }

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("UrgentRequest get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch request." });
  }
});

// ── Chat: get messages ────────────────────────────────────────────────────────

router.get("/:id/messages", authenticate, async (req, res) => {
  try {
    const request = await UrgentRequest.findById(req.params.id).lean();
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    if (request.status !== "accepted" && request.status !== "completed") {
      return res.status(403).json({
        success: false,
        message: "Chat only available after acceptance.",
      });
    }
    const { isOwner, isAcceptor } = await assertAccess(request, req);
    if (!isOwner && !isAcceptor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const viewerId = uid(req.user);
    const markRead = String(req.query.markRead || "") === "1";
    const recipientId = isOwner
      ? request.acceptedBy
      : request.createdBy;
    const otherSenderRole = isOwner ? "purchaser" : "user";

    if (markRead && recipientId) {
      await UrgentRequestMessage.updateMany(
        {
          requestId: req.params.id,
          senderRole: otherSenderRole,
          senderId: { $ne: viewerId },
        },
        {
          $set: { deliveredAt: new Date() },
          $addToSet: { readBy: viewerId },
        }
      );
    } else if (recipientId) {
      await UrgentRequestMessage.updateMany(
        {
          requestId: req.params.id,
          senderRole: otherSenderRole,
          senderId: { $ne: viewerId },
          deliveredAt: null,
        },
        {
          $set: { deliveredAt: new Date() },
        }
      );
    }

    const messages = await UrgentRequestMessage.find({ requestId: req.params.id })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ success: true, data: messages });
  } catch (err) {
    console.error("UrgentRequest messages GET error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch messages." });
  }
});

// ── Chat: post a message ──────────────────────────────────────────────────────

router.post("/:id/messages", authenticate, async (req, res) => {
  try {
    const request = await UrgentRequest.findById(req.params.id).lean();
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    if (request.status !== "accepted" && request.status !== "completed") {
      return res.status(403).json({
        success: false,
        message: "Chat only available after acceptance.",
      });
    }
    const { isOwner, isAcceptor } = await assertAccess(request, req);
    if (!isOwner && !isAcceptor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: "text is required." });
    }
    const senderRole = isOwner ? "user" : "purchaser";
    const senderName = isOwner
      ? req.user.medicalName || req.user.ownerName || req.user.email
      : req.user.fullName || req.user.email;
    const msg = await UrgentRequestMessage.create({
      requestId: req.params.id,
      senderRole,
      senderId: uid(req.user),
      senderName,
      text: String(text).trim(),
      deliveredAt: new Date(),
    });
    return res.status(201).json({ success: true, data: msg });
  } catch (err) {
    console.error("UrgentRequest messages POST error:", err);
    return res.status(500).json({ success: false, message: "Failed to send message." });
  }
});

module.exports = router;
