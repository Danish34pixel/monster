const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Demand = require("../models/Demand");
const SupplierDemand = require("../models/SupplierDemand");
const DemandMessage = require("../models/DemandMessage");
const Stockist = require("../models/Stockist");
const User = require("../models/User");
const { authenticate, optionalAuthenticate } = require("../middleware/auth");
const { distributeDemand } = require("../services/demandDistributionService");
const SYSTEM_MESSAGES = require("../config/demandSystemMessages");

const uid = (user) => String(user._id || user.id);

// Medical owners are stored with role "medical_owner" (current default) or
// legacy "user" (pre-migration accounts); "admin" for admin override. Mirrors
// the same convention fixed in routes/urgentRequest.js.
const isMedicalOwner = (user) => ["user", "medical_owner", "admin"].includes(user.role);
const isStockist = (user) => user.role === "stockist";

async function assertDemandAccess(supplierDemand, demand, req) {
  const callerId = uid(req.user);
  const isOwner =
    String(demand.purchaserId) === callerId && isMedicalOwner(req.user);
  const isAcceptor =
    String(supplierDemand.stockistId) === callerId && isStockist(req.user);
  return { isOwner, isAcceptor };
}

/**
 * POST /api/demand/create
 * Body: { items: [{ name }], config?: { assignToAllSuppliers?: boolean } }
 *
 * Creates one original demand and auto-distributes item-wise demands to
 * available suppliers (stockists), based on item availability only.
 */
router.post("/create", optionalAuthenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required",
      });
    }

    const cleanedItems = [];
    const seen = new Set();
    for (const it of rawItems) {
      const name = String(it && it.name ? it.name : "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      cleanedItems.push({ name });
    }

    if (cleanedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid item name is required",
      });
    }

    const assignToAllSuppliers =
      body?.config?.assignToAllSuppliers !== undefined
        ? Boolean(body.config.assignToAllSuppliers)
        : true;

    const distribution = await distributeDemand(
      { items: cleanedItems },
      { assignToAllSuppliers }
    );

    const purchaserId =
      (req.user && (req.user._id || req.user.id) && String(req.user._id || req.user.id)) ||
      (body.purchaserId ? String(body.purchaserId) : null);
    const purchaserName =
      (req.user && (req.user.fullName || req.user.medicalName || req.user.name || req.user.email)) ||
      body.purchaserName ||
      null;

    const originalDemand = await Demand.create({
      purchaserId,
      purchaserName,
      lines: cleanedItems.map((it) => {
        const matched = distribution.inventory.find(inv => inv.requestedAs.toLowerCase() === it.name.toLowerCase());
        const hasStockists = Boolean(matched && matched.stockists.length > 0);
        return {
          name: it.name,
          qty: 1,
          matchedMedicineId: matched ? matched.medicineId : null,
          matchedMedicineName: matched ? matched.medicineName : null,
          // Every matched stockist is recorded (and every one is actually
          // notified via SupplierDemand) — there is no single "the" assigned
          // stockist when several carry the same item.
          assignedStockistIds: hasStockists ? matched.stockists.map((s) => s.id) : [],
          assignedStockistNames: hasStockists ? matched.stockists.map((s) => s.name) : [],
          status: hasStockists ? "assigned" : "unmatched",
        };
      }),
      inventorySnapshot: distribution.inventory,
      note: body.note || null,
    });

    let createdSupplierDemands = [];
    if (distribution.supplierDemands.length > 0) {
      createdSupplierDemands = await SupplierDemand.insertMany(
        distribution.supplierDemands.map((sd) => ({
          stockistId: sd.stockistId,
          items: sd.items,
          status: "pending",
          originalDemandId: originalDemand._id,
        })),
        { ordered: false }
      );
    }

    return res.status(201).json({
      success: true,
      message: "Demand sent to available suppliers automatically",
      data: {
        originalDemandId: originalDemand._id,
        assignToAllSuppliers: distribution.assignToAllSuppliers,
        itemsRequested: distribution.itemsRequested,
        matchedItems: distribution.matchedItems,
        suppliersInvolved: distribution.suppliersInvolved,
        inventory: distribution.inventory, // Added inventory mapping to response
        supplierDemands: await SupplierDemand.find({ originalDemandId: originalDemand._id }).populate('stockistId', 'name contactPerson phone contactNo address').then(res => res.map(d => ({
          _id: d._id,
          stockistId: d.stockistId,
          items: d.items,
          status: d.status,
          originalDemandId: d.originalDemandId,
        }))),
        unfulfilledItems: distribution.unfulfilledItems,
      },
    });
  } catch (err) {
    console.error("Demand create/distribute error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create and distribute demand",
    });
  }
});

/**
 * POST /api/demand
 * Body: { purchaserId, purchaserName, lines: [{ name, qty }] }
 *
 * Saves the demand to the DB. Each line is matched against the
 * Medicine collection (case-insensitive) and given a status.
 */
router.post("/", async (req, res) => {
  try {
    const { purchaserId, purchaserName, lines, extendedLines, note } = req.body || {};

    let resolvedLines = [];

    // If frontend provides exact extended lines with stockist groupings, use them
    if (Array.isArray(extendedLines) && extendedLines.length > 0) {
      resolvedLines = extendedLines.map(l => ({
        name: l.name || "(blank)",
        qty: Math.max(1, parseInt(l.qty, 10) || 1),
        status: l.status || "unmatched",
        matchedMedicineId: l.matchedMedicineId || null,
        matchedMedicineName: l.matchedMedicineName || null,
        assignedStockistIds: Array.isArray(l.assignedStockistIds)
          ? l.assignedStockistIds
          : l.assignedStockistId
            ? [l.assignedStockistId]
            : [],
        assignedStockistNames: Array.isArray(l.assignedStockistNames)
          ? l.assignedStockistNames
          : l.assignedStockistName
            ? [l.assignedStockistName]
            : [],
      }));
    } else if (Array.isArray(lines) && lines.length > 0) {
      // Fallback: standard lines
      const allMedicines = await Medicine.find({ active: { $ne: false } })
        .select("name genericName _id")
        .lean();

      resolvedLines = lines.map((l) => {
        const nameRaw = (l.name || "").toString().trim();
        const qty = Math.max(1, parseInt(l.qty, 10) || 1);

        if (!nameRaw) return { name: "(blank)", qty, status: "unmatched" };

        const q = nameRaw.toLowerCase();
        let match =
          allMedicines.find((m) => m.name.toLowerCase() === q) ||
          allMedicines.find((m) => m.name.toLowerCase().includes(q)) ||
          allMedicines.find((m) => q.includes(m.name.toLowerCase()));

        if (match) {
          return {
            name: nameRaw,
            qty,
            matchedMedicineId: match._id,
            matchedMedicineName: match.name,
            status: "matched",
          };
        }
        return { name: nameRaw, qty, status: "unmatched" };
      });
    } else {
      return res.status(400).json({ success: false, message: "lines or extendedLines required" });
    }

    const demand = new Demand({
      purchaserId: purchaserId || null,
      purchaserName: purchaserName || null,
      lines: resolvedLines,
      note: note || null,
    });

    await demand.save();

    return res.json({
      success: true,
      message: "Demand recorded successfully",
      data: demand,
    });
  } catch (err) {
    console.error("Demand POST error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/demand
 * - ?stockistId=X  -> demands actually sent to this stockist (SupplierDemand
 *   records with status other than "pending" — "pending" means the
 *   auto-distribution service found a candidate match but the medical owner
 *   has not clicked "Send" yet, so the stockist shouldn't see it).
 * - ?purchaserId=X or ?ownerId=X (alias) -> the medical owner's own demands,
 *   enriched with each per-stockist SupplierDemand's status.
 */
router.get("/", async (req, res) => {
  try {
    if (req.query.stockistId) {
      const supplierDemands = await SupplierDemand.find({
        stockistId: req.query.stockistId,
        status: { $ne: "pending" },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const data = await Promise.all(
        supplierDemands.map(async (sd) => {
          const demand = await Demand.findById(sd.originalDemandId)
            .select("purchaserId purchaserName")
            .lean();
          // Match the owner-side branch below: only reveal contact info
          // once the stockist has actually accepted the order.
          let ownerPhone = null;
          if (
            demand?.purchaserId &&
            ["accepted", "dispatched", "completed"].includes(sd.status)
          ) {
            const owner = await User.findById(demand.purchaserId)
              .select("contactNo medicalName ownerName")
              .lean();
            ownerPhone = owner?.contactNo || null;
          }
          return {
            _id: sd._id,
            status: sd.status,
            items: sd.items,
            purchaserName: demand?.purchaserName || null,
            ownerPhone,
            sentAt: sd.sentAt,
            acceptedAt: sd.acceptedAt,
            dispatchedAt: sd.dispatchedAt,
            createdAt: sd.createdAt,
          };
        })
      );

      return res.json({ success: true, data });
    }

    const purchaserId = req.query.purchaserId || req.query.ownerId;
    const filter = {};
    if (purchaserId) filter.purchaserId = purchaserId;

    const demands = await Demand.find(filter).sort({ createdAt: -1 }).limit(50).lean();

    const data = await Promise.all(
      demands.map(async (d) => {
        const supplierDemands = await SupplierDemand.find({ originalDemandId: d._id })
          .select("stockistId status items sentAt acceptedAt dispatchedAt")
          .lean();

        const enriched = await Promise.all(
          supplierDemands.map(async (sd) => {
            let stockistName = null;
            let stockistPhone = null;
            if (["accepted", "dispatched", "completed"].includes(sd.status)) {
              const stockist = await Stockist.findById(sd.stockistId)
                .select("name phone")
                .lean();
              stockistName = stockist?.name || null;
              stockistPhone = stockist?.phone || null;
            }
            return { ...sd, stockistName, stockistPhone };
          })
        );

        return { ...d, supplierDemands: enriched };
      })
    );

    return res.json({ success: true, data });
  } catch (err) {
    console.error("Demand GET error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Medical owner: send a candidate demand to a specific stockist ───────────

router.post("/:id/send", authenticate, async (req, res) => {
  try {
    if (!isMedicalOwner(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only medical owners can send demands.",
      });
    }

    const demand = await Demand.findById(req.params.id).lean();
    if (!demand) {
      return res.status(404).json({ success: false, message: "Demand not found." });
    }
    if (String(demand.purchaserId) !== uid(req.user)) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const { stockistId } = req.body || {};
    if (!stockistId) {
      return res.status(400).json({ success: false, message: "stockistId is required." });
    }

    const updated = await SupplierDemand.findOneAndUpdate(
      { originalDemandId: req.params.id, stockistId, status: "pending" },
      { $set: { status: "sent", sentAt: new Date() } },
      { new: true }
    );

    if (!updated) {
      const existing = await SupplierDemand.findOne({
        originalDemandId: req.params.id,
        stockistId,
      }).lean();
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "No matching demand for this stockist.",
        });
      }
      return res.status(409).json({
        success: false,
        message: `Demand already ${existing.status} for this stockist.`,
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Demand send error:", err);
    return res.status(500).json({ success: false, message: "Failed to send demand." });
  }
});

// ── Stockist: accept or reject a sent demand ─────────────────────────────────
// PATCH /:id is intentionally status-only (not a general field editor) — a
// medical owner cannot rewrite items after send, a stockist cannot touch
// dispatch here (that's its own endpoint below).

router.patch("/:id", authenticate, async (req, res) => {
  try {
    if (!isStockist(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only the target stockist can update this demand.",
      });
    }

    const { status } = req.body || {};
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be 'accepted' or 'rejected' (use /dispatch to mark dispatched).",
      });
    }

    const timestampField = status === "accepted" ? "acceptedAt" : "rejectedAt";
    const updated = await SupplierDemand.findOneAndUpdate(
      { _id: req.params.id, stockistId: uid(req.user), status: "sent" },
      { $set: { status, [timestampField]: new Date() } },
      { new: true }
    );

    if (!updated) {
      const existing = await SupplierDemand.findById(req.params.id).lean();
      if (!existing) {
        return res.status(404).json({ success: false, message: "Demand not found." });
      }
      if (String(existing.stockistId) !== uid(req.user)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      return res.status(409).json({
        success: false,
        message: `Demand already ${existing.status}.`,
      });
    }

    if (status === "accepted") {
      await DemandMessage.create({
        supplierDemandId: updated._id,
        senderRole: "system",
        text: SYSTEM_MESSAGES.ACCEPTED,
        deliveredAt: new Date(),
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Demand PATCH error:", err);
    return res.status(500).json({ success: false, message: "Failed to update demand." });
  }
});

// ── Stockist: mark an accepted demand as dispatched ──────────────────────────

router.post("/:id/dispatch", authenticate, async (req, res) => {
  try {
    if (!isStockist(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only the target stockist can dispatch this demand.",
      });
    }

    const updated = await SupplierDemand.findOneAndUpdate(
      { _id: req.params.id, stockistId: uid(req.user), status: "accepted" },
      { $set: { status: "dispatched", dispatchedAt: new Date() } },
      { new: true }
    );

    if (!updated) {
      const existing = await SupplierDemand.findById(req.params.id).lean();
      if (!existing) {
        return res.status(404).json({ success: false, message: "Demand not found." });
      }
      if (String(existing.stockistId) !== uid(req.user)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      return res.status(409).json({
        success: false,
        message:
          existing.status === "accepted"
            ? "Already dispatched."
            : `Cannot dispatch a demand that is '${existing.status}' (must be accepted first).`,
      });
    }

    await DemandMessage.create({
      supplierDemandId: updated._id,
      senderRole: "system",
      text: SYSTEM_MESSAGES.DISPATCHED,
      deliveredAt: new Date(),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Demand dispatch error:", err);
    return res.status(500).json({ success: false, message: "Failed to dispatch demand." });
  }
});

// ── Chat: get messages ────────────────────────────────────────────────────────

router.get("/:id/messages", authenticate, async (req, res) => {
  try {
    const supplierDemand = await SupplierDemand.findById(req.params.id).lean();
    if (!supplierDemand) {
      return res.status(404).json({ success: false, message: "Demand not found." });
    }
    if (!["accepted", "dispatched", "completed"].includes(supplierDemand.status)) {
      return res.status(403).json({
        success: false,
        message: "Chat only available after acceptance.",
      });
    }
    const demand = await Demand.findById(supplierDemand.originalDemandId).lean();
    if (!demand) {
      return res.status(404).json({ success: false, message: "Demand not found." });
    }
    const { isOwner, isAcceptor } = await assertDemandAccess(supplierDemand, demand, req);
    if (!isOwner && !isAcceptor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const viewerId = uid(req.user);
    const markRead = String(req.query.markRead || "") === "1";
    const otherSenderRole = isOwner ? "stockist" : "medical_owner";

    if (markRead) {
      await DemandMessage.updateMany(
        {
          supplierDemandId: req.params.id,
          senderRole: { $in: [otherSenderRole, "system"] },
          senderId: { $ne: viewerId },
        },
        { $set: { deliveredAt: new Date() }, $addToSet: { readBy: viewerId } }
      );
    } else {
      await DemandMessage.updateMany(
        {
          supplierDemandId: req.params.id,
          senderRole: { $in: [otherSenderRole, "system"] },
          senderId: { $ne: viewerId },
          deliveredAt: null,
        },
        { $set: { deliveredAt: new Date() } }
      );
    }

    const messages = await DemandMessage.find({ supplierDemandId: req.params.id })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ success: true, data: messages });
  } catch (err) {
    console.error("Demand messages GET error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch messages." });
  }
});

// ── Chat: post a message ──────────────────────────────────────────────────────

router.post("/:id/messages", authenticate, async (req, res) => {
  try {
    const supplierDemand = await SupplierDemand.findById(req.params.id).lean();
    if (!supplierDemand) {
      return res.status(404).json({ success: false, message: "Demand not found." });
    }
    if (!["accepted", "dispatched", "completed"].includes(supplierDemand.status)) {
      return res.status(403).json({
        success: false,
        message: "Chat only available after acceptance.",
      });
    }
    const demand = await Demand.findById(supplierDemand.originalDemandId).lean();
    if (!demand) {
      return res.status(404).json({ success: false, message: "Demand not found." });
    }
    const { isOwner, isAcceptor } = await assertDemandAccess(supplierDemand, demand, req);
    if (!isOwner && !isAcceptor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: "text is required." });
    }

    const senderRole = isOwner ? "medical_owner" : "stockist";
    const senderName = isOwner
      ? req.user.medicalName || req.user.ownerName || req.user.email
      : req.user.name || req.user.contactPerson || req.user.email;

    const msg = await DemandMessage.create({
      supplierDemandId: req.params.id,
      senderRole,
      senderId: uid(req.user),
      senderName,
      text: String(text).trim(),
      deliveredAt: new Date(),
    });

    return res.status(201).json({ success: true, data: msg });
  } catch (err) {
    console.error("Demand messages POST error:", err);
    return res.status(500).json({ success: false, message: "Failed to send message." });
  }
});

module.exports = router;

