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
    const { name, description, active, stockists, stockistIds: bodyStockistIds } = req.body;

    // DEBUG: Log incoming request
    try {
      require("fs").appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] createCompany req.body: ${JSON.stringify(req.body)}\n`,
      );
    } catch (e) {}

    // Combine stockists and stockistIds to be safe
    const combinedIncoming = [
      ...(Array.isArray(stockists) ? stockists : stockists ? [stockists] : []),
      ...(Array.isArray(bodyStockistIds) ? bodyStockistIds : bodyStockistIds ? [bodyStockistIds] : []),
    ];

    const normalizedStockists = combinedIncoming
      .map((item) => {
        if (!item) return null;
        if (typeof item === "object") {
          const sid = item._id || item.id || item.value;
          if (sid && mongoose.Types.ObjectId.isValid(String(sid)))
            return String(sid);
          const sname = item.name || item.label;
          if (typeof sname === "string" && sname.trim()) return sname.trim();
          return null;
        }
        if (typeof item === "string") return item.trim();
        return null;
      })
      .filter(Boolean);

    const idCandidates = normalizedStockists.filter((item) =>
      mongoose.Types.ObjectId.isValid(String(item)),
    );
    const rawNameCandidates = normalizedStockists.filter(
      (item) => !mongoose.Types.ObjectId.isValid(String(item)),
    );

    const query = [];
    if (idCandidates.length > 0) {
      query.push({ _id: { $in: idCandidates } });
    }
    if (rawNameCandidates.length > 0) {
      query.push({
        name: {
          $in: rawNameCandidates.map(
            (n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
          ),
        },
      });
    }

    const stockistDocs =
      query.length > 0
        ? await Stockist.find({ $or: query }).select("name").lean()
        : [];

    const resolvedIdsFromDocs = stockistDocs.map((s) => String(s._id));
    const matchedNames = stockistDocs
      .map((s) => String(s.name).trim())
      .filter(Boolean);

    // Final list of IDs: resolved from docs + any original IDs provided
    const finalStockistIds = Array.from(new Set([...resolvedIdsFromDocs, ...idCandidates]));

    // Final list of names: matched from docs + any raw name candidates that weren't resolved to docs
    const finalStockistNames = Array.from(
      new Set([
        ...matchedNames,
        ...rawNameCandidates.filter(
          (n) =>
            !matchedNames.some((m) => m.toLowerCase() === n.toLowerCase()),
        ),
      ]),
    );

    const payload = {
      name: name.trim(),
      description: description || "",
      active: typeof active === "boolean" ? active : true,
      stockists: finalStockistIds,
      stockistNames: finalStockistNames,
      stockistName: finalStockistNames[0] || "",
    };

    const company = await Company.create(payload);

    // DEBUG: Log creation results
    try {
      require("fs").appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] Result - Name: ${company.name}, Stockists: [${company.stockists.join(",")}], Names: [${company.stockistNames.join(",")}]\n`,
      );
    } catch (e) {}

    let updateResult = null;
    if (finalStockistIds.length > 0) {
      updateResult = await Stockist.updateMany(
        { _id: { $in: finalStockistIds } },
        {
          $addToSet: {
            companies: company._id,
            companyNames: company.name,
          },
        },
      );
    }

    return res.status(201).json({
      success: true,
      data: company,
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

exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const { name, description, active, stockists } = req.body;
    const oldCompany = await Company.findById(id).lean();
    if (!oldCompany) {
      return res
        .status(404)
        .json({ success: false, message: "Company not found" });
    }

    const normalizedStockists = Array.isArray(stockists)
      ? stockists
          .map((item) => {
            if (!item) return null;
            if (typeof item === "object") {
              const sid = item._id || item.id || item.value;
              if (sid && mongoose.Types.ObjectId.isValid(String(sid)))
                return String(sid);
              const sname = item.name || item.label;
              if (typeof sname === "string" && sname.trim()) return sname.trim();
              return null;
            }
            if (typeof item === "string") return item.trim();
            return null;
          })
          .filter(Boolean)
      : null;

    const updatePayload = {};
    if (name) updatePayload.name = name.trim();
    if (description !== undefined) updatePayload.description = description;
    if (active !== undefined) updatePayload.active = active;

    if (normalizedStockists) {
      const idCandidates = normalizedStockists.filter((item) =>
        mongoose.Types.ObjectId.isValid(String(item)),
      );
      const nameCandidates = normalizedStockists.filter(
        (item) => !mongoose.Types.ObjectId.isValid(String(item)),
      );

      const query = {
        $or: [
          ...(idCandidates.length > 0 ? [{ _id: { $in: idCandidates } }] : []),
          ...(nameCandidates.length > 0
            ? [
                {
                  name: {
                    $in: nameCandidates.map(
                      (n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
                    ),
                  },
                },
              ]
            : []),
        ],
      };

      const stockistDocs =
        idCandidates.length > 0 || nameCandidates.length > 0
          ? await Stockist.find(query).select("_id name").lean()
          : [];

      updatePayload.stockists = stockistDocs.map((s) => String(s._id));
      updatePayload.stockistNames = Array.from(
        new Set([
          ...stockistDocs.map((s) => s.name.trim()),
          ...nameCandidates, // include names that didn't match a doc
        ]),
      );
    }

    const company = await Company.findByIdAndUpdate(id, updatePayload, {
      new: true,
    }).lean();

    // Handle Stockist linkage updates
    if (normalizedStockists) {
      const oldStockistIds = (oldCompany.stockists || []).map(String);
      const newStockistIds = (company.stockists || []).map(String);

      const toAdd = newStockistIds.filter((sid) => !oldStockistIds.includes(sid));
      const toRemove = oldStockistIds.filter(
        (sid) => !newStockistIds.includes(sid),
      );

      if (toAdd.length > 0) {
        await Stockist.updateMany(
          { _id: { $in: toAdd } },
          { $addToSet: { companies: company._id, companyNames: company.name } },
        );
      }
      if (toRemove.length > 0) {
        await Stockist.updateMany(
          { _id: { $in: toRemove } },
          { $pull: { companies: company._id, companyNames: company.name } },
        );
      }
      // If the company name changed, update all linked stockists
      if (oldCompany.name !== company.name) {
        await Stockist.updateMany(
          { companies: company._id },
          { $set: { "companyNames.$[name]": company.name } },
          { arrayFilters: [{ name: oldCompany.name }] },
        );
      }
    }

    return res.json({ success: true, data: company });
  } catch (err) {
    console.error("updateCompany error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update company" });
  }
};

