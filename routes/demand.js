const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Demand = require("../models/Demand");

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
