const mongoose = require("mongoose");
const Company = require("../models/Company");
const Stockist = require("../models/Stockist");

exports.getCompanies = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Number.parseInt(page, 10) || 1;
    limit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 10));

    const totalCompanies = await Company.countDocuments();
    const data = await Company.find()
      .select(
        "name description active stockists stockistNames createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalCompanies / limit),
      totalCompanies,
      count: data.length,
      data,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch companies" });
  }
};

exports.createCompany = async (req, res) => {
  try {
    const { name, description, active, stockists } = req.body;

    const normalizedStockists = Array.isArray(stockists)
      ? stockists
          .map((item) => {
            if (!item) return null;
            if (typeof item === "object") {
              if (item._id && mongoose.Types.ObjectId.isValid(String(item._id)))
                return String(item._id);
              if (item.id && mongoose.Types.ObjectId.isValid(String(item.id)))
                return String(item.id);
              if (
                item.value &&
                mongoose.Types.ObjectId.isValid(String(item.value))
              )
                return String(item.value);
              if (typeof item.name === "string" && item.name.trim())
                return item.name.trim();
              if (typeof item.label === "string" && item.label.trim())
                return item.label.trim();
              return null;
            }
            if (typeof item === "string") return item.trim();
            return null;
          })
          .filter(Boolean)
      : [];

    const normalizeName = (value) =>
      String(value || "")
        .trim()
        .toLowerCase();
    const idCandidates = normalizedStockists.filter((item) =>
      mongoose.Types.ObjectId.isValid(String(item)),
    );
    const rawNameCandidates = normalizedStockists
      .filter((item) => !mongoose.Types.ObjectId.isValid(String(item)))
      .map((item) => String(item).trim())
      .filter(Boolean);
    const nameCandidates = rawNameCandidates.map((item) => normalizeName(item));

    const query = [];
    if (idCandidates.length > 0) {
      query.push({ _id: { $in: idCandidates } });
    }
    if (nameCandidates.length > 0) {
      query.push({
        name: {
          $in: nameCandidates.map(
            (n) =>
              new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
          ),
        },
      });
    }

    const stockistDocs =
      query.length > 0
        ? await Stockist.find({ $or: query }).select("name").lean()
        : [];

    const stockistIds = stockistDocs.map((s) => String(s._id));
    const matchedNames = stockistDocs
      .map((s) => String(s.name).trim())
      .filter(Boolean);
    const payload = {
      name,
      description,
      active: typeof active === "boolean" ? active : true,
      stockists: stockistIds,
      stockistNames: Array.from(
        new Set([
          ...matchedNames,
          ...rawNameCandidates.filter(
            (name) =>
              !matchedNames.some(
                (matched) => matched.toLowerCase() === name.toLowerCase(),
              ),
          ),
        ]),
      ),
    };

    const company = await Company.create(payload);

    // DEBUG: Log creation success
    try {
      require("fs").appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] Created company: ${company.name} (${company._id})\n`,
      );
    } catch (e) {}

    let updateResult = null;
    // 2. If stockists are provided, update each stockist to link back to this company
    if (payload.stockists.length > 0) {
      updateResult = await Stockist.updateMany(
        { _id: { $in: payload.stockists } },
        { $addToSet: { companies: company._id } },
      );

      // DEBUG: Log update result
      try {
        require("fs").appendFileSync(
          "db_debug.txt",
          `[${new Date().toISOString()}] Linked to ${updateResult.modifiedCount}/${payload.stockists.length} stockists.\n`,
        );
      } catch (e) {}
    }

    return res.status(201).json({
      success: true,
      data: {
        _id: company._id,
        name: company.name,
        description: company.description,
        active: company.active,
        stockists: company.stockists,
        stockistNames: company.stockistNames,
      },
      updateResult,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "Company already exists" });
    }
    return res
      .status(500)
      .json({ success: false, message: "Failed to create company" });
  }
};
