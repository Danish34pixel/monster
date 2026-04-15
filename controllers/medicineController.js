const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");
const Company = require("../models/Company");
const Stockist = require("../models/Stockist");

exports.getMedicines = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Number.parseInt(page, 10) || 1;
    limit = Math.min(1000, Number.parseInt(limit, 10) || 10);

    const totalMedicines = await Medicine.countDocuments();
    const data = await Medicine.find()
      .select(
        "name genericName manufacturer price category company companyName stockists stockistNames active createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalMedicines / limit),
      totalMedicines,
      count: data.length,
      data,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch medicines" });
  }
};

async function buildMedicinePayload(body = {}) {
  const payload = {
    name: body.name,
    genericName: body.genericName,
    manufacturer: body.manufacturer,
    price: body.price,
    category: body.category,
    active: typeof body.active === "boolean" ? body.active : true,
    stockists: [],
    stockistNames: [],
    companyName: undefined,
  };

  const stockistInputs = body.stockists || body.stockistIds || [];
  const stockistIdCandidates = new Set();
  const stockistNameCandidates = new Set();

  const normalizeStockistInput = (stockist) => {
    if (typeof stockist === "string") {
      const trimmed = stockist.trim();
      if (!trimmed) return;
      if (mongoose.Types.ObjectId.isValid(trimmed)) {
        stockistIdCandidates.add(trimmed);
      } else {
        stockistNameCandidates.add(trimmed);
      }
      return;
    }

    if (stockist && typeof stockist === "object") {
      const id = stockist._id || stockist.id || stockist.value;
      const name = stockist.name || stockist.label;
      if (id && mongoose.Types.ObjectId.isValid(String(id))) {
        stockistIdCandidates.add(String(id));
      }
      if (typeof name === "string" && name.trim()) {
        stockistNameCandidates.add(name.trim());
      }
    }
  };

  if (Array.isArray(stockistInputs)) {
    stockistInputs.forEach(normalizeStockistInput);
  } else {
    normalizeStockistInput(stockistInputs);
  }

  const resolvedStockistNames = new Set();
  if (stockistIdCandidates.size > 0) {
    const stockistDocs = await Stockist.find({
      _id: { $in: Array.from(stockistIdCandidates) },
    })
      .select("name")
      .lean();
    stockistDocs.forEach((doc) => {
      if (doc?.name) {
        resolvedStockistNames.add(doc.name);
      }
    });
  }

  if (stockistNameCandidates.size > 0) {
    const stockistDocs = await Stockist.find({
      name: { $in: Array.from(stockistNameCandidates) },
    })
      .select("_id name")
      .lean();
    stockistDocs.forEach((doc) => {
      if (doc?._id) {
        stockistIdCandidates.add(String(doc._id));
      }
      if (doc?.name) {
        resolvedStockistNames.add(doc.name);
      }
    });
    Array.from(stockistNameCandidates).forEach((name) => {
      if (![...resolvedStockistNames].includes(name)) {
        resolvedStockistNames.add(name);
      }
    });
  }

  payload.stockists = Array.from(stockistIdCandidates);
  payload.stockistNames = Array.from(resolvedStockistNames);

  let companyInput = body.company;
  let companyId = null;
  let companyName = null;

  if (companyInput && typeof companyInput === "object") {
    companyId = companyInput._id || companyInput.id || companyInput.value;
    companyName = companyInput.name || companyInput.label;
  } else if (typeof companyInput === "string") {
    const trimmed = companyInput.trim();
    if (trimmed) companyId = trimmed;
  }

  if (companyId && mongoose.Types.ObjectId.isValid(String(companyId))) {
    payload.company = String(companyId);
    if (!companyName) {
      const company = await Company.findById(companyId).select("name").lean();
      if (company?.name) {
        companyName = company.name;
      }
    }
  } else if (typeof companyId === "string" && companyId.trim()) {
    const companyNameFromString = companyId.trim();
    const company = await Company.findOne({
      name: companyNameFromString,
    })
      .select("_id name")
      .lean();
    if (company) {
      payload.company = String(company._id);
      companyName = company.name;
    } else {
      companyName = companyNameFromString;
    }
  }

  if (typeof companyName === "string" && companyName.trim()) {
    payload.companyName = companyName.trim();
  }

  return payload;
}

async function handleMedicineCreate(req, res) {
  try {
    const payload = await buildMedicinePayload(req.body || {});
    const medicine = await Medicine.create(payload);

    // DEBUG: Log creation success
    try {
      const fs = require("fs");
      fs.appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] Created medicine: ${medicine.name} (${medicine._id})\n`,
      );
    } catch (e) {}

    const updatedStockistIds = new Set();

    // Link to stockists provided in the payload
    if (Array.isArray(payload.stockists) && payload.stockists.length > 0) {
      for (const sid of payload.stockists) {
        try {
          await Stockist.findByIdAndUpdate(
            sid,
            { $addToSet: { medicines: medicine.name } },
            { new: true },
          );
          updatedStockistIds.add(String(sid));
        } catch (err) {
          console.error(
            `Failed to link medicine to stockist ${sid}:`,
            err.message,
          );
        }
      }
    }

    // Link to stockist if the creator is a stockist and not already included
    if (
      req.user &&
      req.user.role === "stockist" &&
      !updatedStockistIds.has(String(req.user._id))
    ) {
      try {
        await Stockist.findByIdAndUpdate(
          req.user._id,
          { $addToSet: { medicines: medicine.name } },
          { new: true },
        );
        updatedStockistIds.add(String(req.user._id));
      } catch (err) {
        console.error(
          `Failed to link medicine to creator stockist ${req.user._id}:`,
          err.message,
        );
      }
    }

    // DEBUG: Log linkage summary
    try {
      const fs = require("fs");
      fs.appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] Medicine '${medicine.name}' linked to ${updatedStockistIds.size} stockists\n`,
      );
    } catch (e) {}

    return res.status(201).json({
      success: true,
      data: {
        _id: medicine._id,
        name: medicine.name,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
        price: medicine.price,
        category: medicine.category,
        company: medicine.company,
        companyName: medicine.companyName,
        stockists: medicine.stockists,
        stockistNames: medicine.stockistNames,
      },
      linkedCount: updatedStockistIds.size,
    });
  } catch (err) {
    console.error(
      "medicine create error:",
      err && err.message ? err.message : err,
    );
    return res.status(500).json({
      success: false,
      message: "Failed to create medicine",
      error: err.message || String(err),
    });
  }
}

exports.createMedicineQuick = handleMedicineCreate;
exports.createMedicine = handleMedicineCreate;
