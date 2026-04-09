const Medicine = require("../models/Medicine");
const Stockist = require("../models/Stockist");
const Company = require("../models/Company");

// lightweight normalization helpers copied from frontend logic (safe server-side)
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(s) {
  return new Set((normalize(s) || "").split(" ").filter((t) => t.length > 2));
}

function tokenOverlapScore(medName, stockist) {
  try {
    const mTokens = tokensOf(medName);
    if (mTokens.size === 0) return 0;
    const lists = [
      stockist.Medicines,
      stockist.medicines,
      stockist.items,
      stockist.itemsList,
      stockist.companies,
    ];
    let best = 0;
    for (const lst of lists) {
      if (!Array.isArray(lst)) continue;
      for (const it of lst) {
        const cTokens = tokensOf(it);
        let overlap = 0;
        for (const t of mTokens) if (cTokens.has(t)) overlap++;
        if (overlap > best) best = overlap;
      }
    }
    if (stockist.title) {
      const cTokens = tokensOf(stockist.title);
      let overlap = 0;
      for (const t of mTokens) if (cTokens.has(t)) overlap++;
      if (overlap > best) best = overlap;
    }
    return best;
  } catch (e) {
    return 0;
  }
}

exports.backfillDryRun = async (req, res) => {
  try {
    const medicines = await Medicine.find().lean();
    const stockists = await Stockist.find().lean();
    const companies = await Company.find().lean();

    const report = [];
    for (const med of medicines) {
      const name =
        med.name ||
        med.brandName ||
        med.title ||
        med.medicineName ||
        med.displayName ||
        "";

      // skip if medicine already references a stockist (quick heuristic)
      if (
        med.stockists ||
        med.stockist ||
        med.seller ||
        med.sellerId ||
        med.stockistId
      ) {
        report.push({
          medicineId: med._id,
          name,
          reason: "has stockist ref, skipped",
        });
        continue;
      }

      // compute best stockist by token overlap
      let bestScore = 0;
      let bestStockist = null;
      for (const s of stockists) {
        const score = tokenOverlapScore(name, s);
        if (score > bestScore) {
          bestScore = score;
          bestStockist = s;
        }
      }

      // also try company match if med.company exists
      let companyMatch = null;
      if (med.company) {
        const compId = String(med.company._id || med.company);
        const found = companies.find(
          (c) => String(c._id) === compId || String(c.id) === compId
        );
        if (found) companyMatch = found;
      }

      report.push({
        medicineId: med._id,
        name,
        bestStockistId: bestStockist ? bestStockist._id : null,
        bestStockistName: bestStockist
          ? bestStockist.name || bestStockist.title
          : null,
        score: bestScore,
        companyMatch: companyMatch
          ? {
              id: companyMatch._id,
              name: companyMatch.name || companyMatch.shortName,
            }
          : null,
      });
    }

    // sort report by score desc to show highest-confidence suggestions first
    report.sort((a, b) => (b.score || 0) - (a.score || 0));

    return res.json({ success: true, count: report.length, report });
  } catch (err) {
    console.error("backfillDryRun error", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
