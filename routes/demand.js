const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Demand = require("../models/Demand");
const SupplierDemand = require("../models/SupplierDemand");
const { optionalAuthenticate } = require("../middleware/auth");
const { distributeDemand } = require("../services/demandDistributionService");

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
        return {
          name: it.name,
          qty: 1,
          matchedMedicineName: matched ? matched.medicineName : null,
          status: (matched && matched.stockists.length > 0) ? "assigned" : "unmatched",
        };
      }),
      inventorySnapshot: distribution.inventory,
      note: body.note || null,
    });

    let createdSupplierDemands = [];
    if (distribution.supplierDemands.length > 0) {
      createdSupplierDemands = await SupplierDemand.insertMany(
        distribution.supplierDemands.map((sd) => ({
          supplierId: sd.supplierId,
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
        supplierDemands: await SupplierDemand.find({ originalDemandId: originalDemand._id }).populate('supplierId', 'name contactPerson phone contactNo address').then(res => res.map(d => ({
          _id: d._id,
          supplierId: d.supplierId,
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
        assignedStockistId: l.assignedStockistId || null,
        assignedStockistName: l.assignedStockistName || null,
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
 * Lists demands – optionally filtered by purchaserId or stockistId
 */
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.purchaserId) filter.purchaserId = req.query.purchaserId;
    if (req.query.stockistId) {
      filter["lines.assignedStockistId"] = req.query.stockistId;
    }

    let demands = await Demand.find(filter).sort({ createdAt: -1 }).limit(50).lean();

    // If fetching for a specific stockist, filter the lines to only show what is assigned to them
    if (req.query.stockistId) {
      demands = demands.map(d => {
        return {
          ...d,
          lines: d.lines.filter(l => String(l.assignedStockistId) === req.query.stockistId)
        };
      }).filter(d => d.lines.length > 0);
    }

    return res.json({ success: true, data: demands });
  } catch (err) {
    console.error("Demand GET error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

