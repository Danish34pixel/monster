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
        "name description active stockists stockistNames stockistName createdAt updatedAt",
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
    const trimmedName = String(name || "").trim();

    if (!trimmedName) {
      return res.status(400).json({ success: false, message: "Company name is required" });
    }

    const normalizeStockistInput = async () => {
      const combinedIncoming = [
        ...(Array.isArray(stockists) ? stockists : stockists ? [stockists] : []),
        ...(Array.isArray(bodyStockistIds) ? bodyStockistIds : bodyStockistIds ? [bodyStockistIds] : []),
      ];

      const normalizedStockists = combinedIncoming
        .map((item) => {
          if (!item) return null;
          if (typeof item === "object") {
            const sid = item._id || item.id || item.value;
            if (sid && mongoose.Types.ObjectId.isValid(String(sid))) return String(sid);
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
      if (idCandidates.length > 0) query.push({ _id: { $in: idCandidates } });
      if (rawNameCandidates.length > 0) {
        query.push({
          name: {
            $in: rawNameCandidates.map((n) =>
              new RegExp(`^${n.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "i"),
            ),
          },
        });
      }

      const stockistDocs =
        query.length > 0
          ? await Stockist.find({ $or: query }).select("_id name").lean()
          : [];

      const resolvedIdsFromDocs = stockistDocs.map((s) => String(s._id));
      const matchedNames = stockistDocs
        .map((s) => String(s.name).trim())
        .filter(Boolean);

      const finalStockistIds = Array.from(new Set([...resolvedIdsFromDocs, ...idCandidates]));
      const finalStockistNames = Array.from(
        new Set([
          ...matchedNames,
          ...rawNameCandidates.filter(
            (n) => !matchedNames.some((m) => m.toLowerCase() === n.toLowerCase()),
          ),
        ]),
      );

      if (
        req.user &&
        req.user.role === "stockist" &&
        mongoose.Types.ObjectId.isValid(String(req.user._id))
      ) {
        const creatorId = String(req.user._id);
        if (!finalStockistIds.includes(creatorId)) finalStockistIds.push(creatorId);

        const creatorName =
          typeof req.user.name === "string" && req.user.name.trim()
            ? req.user.name.trim()
            : typeof req.user.title === "string" && req.user.title.trim()
              ? req.user.title.trim()
              : null;
        if (
          creatorName &&
          !finalStockistNames.some((n) => n.toLowerCase() === creatorName.toLowerCase())
        ) {
          finalStockistNames.push(creatorName);
        }
      }

      return { finalStockistIds, finalStockistNames };
    };

    // DEBUG: Log incoming request
    try {
      require("fs").appendFileSync(
        "db_debug.txt",
        `[${new Date().toISOString()}] createCompany req.body: ${JSON.stringify(req.body)}\n`,
      );
    } catch (e) {}

    const { finalStockistIds, finalStockistNames } = await normalizeStockistInput();
    const escapedName = trimmedName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const existingCompany = await Company.findOne({
      name: new RegExp(`^${escapedName}$`, "i"),
    });

    const mergeAndSaveCompany = async (companyDoc) => {
      const mergedStockists = Array.from(
        new Set([...(companyDoc.stockists || []).map(String), ...finalStockistIds]),
      );
      const mergedStockistNames = Array.from(
        new Set([...(companyDoc.stockistNames || []), ...finalStockistNames]),
      );

      if (description !== undefined) companyDoc.description = description;
      companyDoc.active = typeof active === "boolean" ? active : companyDoc.active;
      companyDoc.stockists = mergedStockists;
      companyDoc.stockistNames = mergedStockistNames;
      companyDoc.stockistName = mergedStockistNames[0] || companyDoc.stockistName || "";

      const saved = await companyDoc.save();

      if (mergedStockists.length > 0) {
        await Stockist.updateMany(
          { _id: { $in: mergedStockists } },
          {
            $addToSet: {
              companies: saved._id,
              companyNames: saved.name,
            },
          },
        );
      }

      return saved;
    };

    if (existingCompany) {
      const updated = await mergeAndSaveCompany(existingCompany);
      return res.status(200).json({
        success: true,
        message: "Company updated with new stockists",
        data: updated,
      });
    }

    const company = await Company.create({
      name: trimmedName,
      description: description || "",
      active: typeof active === "boolean" ? active : true,
      stockists: finalStockistIds,
      stockistNames: finalStockistNames,
      stockistName: finalStockistNames[0] || "",
    });

    if (finalStockistIds.length > 0) {
      await Stockist.updateMany(
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
    });
  } catch (err) {
    if (err && err.code === 11000) {
      try {
        const { name, description, active, stockists, stockistIds: bodyStockistIds } = req.body;
        const trimmedName = String(name || "").trim();
        const escapedName = trimmedName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
        const existingCompany = await Company.findOne({
          name: new RegExp(`^${escapedName}$`, "i"),
        });

        if (existingCompany) {
          const combinedIncoming = [
            ...(Array.isArray(stockists) ? stockists : stockists ? [stockists] : []),
            ...(Array.isArray(bodyStockistIds) ? bodyStockistIds : bodyStockistIds ? [bodyStockistIds] : []),
          ];
          const candidateIds = combinedIncoming
            .map((item) => {
              if (!item) return null;
              if (typeof item === "object") return String(item._id || item.id || item.value || "").trim();
              return String(item).trim();
            })
            .filter((v) => v && mongoose.Types.ObjectId.isValid(String(v)));

          existingCompany.stockists = Array.from(
            new Set([...(existingCompany.stockists || []).map(String), ...candidateIds]),
          );
          if (description !== undefined) existingCompany.description = description;
          existingCompany.active = typeof active === "boolean" ? active : existingCompany.active;
          existingCompany.stockistNames = Array.from(
            new Set([...(existingCompany.stockistNames || []), ...candidateIds]),
          );
          existingCompany.stockistName = existingCompany.stockistNames[0] || existingCompany.stockistName || "";
          const saved = await existingCompany.save();
          return res.status(200).json({
            success: true,
            message: "Company updated with new stockists",
            data: saved,
          });
        }
      } catch (mergeErr) {
        console.error("Fallback merge after duplicate failed:", mergeErr);
      }
      return res.status(409).json({ success: false, message: "Company already exists" });
    }
    console.error("createCompany error:", err);
    return res.status(500).json({ success: false, message: "Failed to create company" });
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

      const incomingStockistIds = stockistDocs.map((s) => String(s._id));
      const incomingStockistNames = Array.from(
        new Set([
          ...stockistDocs.map((s) => s.name.trim()),
          ...nameCandidates, // include names that didn't match a doc
        ]),
      );

      const mergedStockistIds = Array.from(
        new Set([...(oldCompany.stockists || []).map(String), ...incomingStockistIds]),
      );
      const mergedStockistNames = Array.from(
        new Set([...(oldCompany.stockistNames || []), ...incomingStockistNames]),
      );

      updatePayload.stockists = mergedStockistIds;
      updatePayload.stockistNames = mergedStockistNames;
      updatePayload.stockistName = mergedStockistNames[0] || "";
    }

    const company = await Company.findByIdAndUpdate(id, updatePayload, {
      new: true,
    }).lean();

    // Handle Stockist linkage updates
    if (normalizedStockists) {
      const oldStockistIds = (oldCompany.stockists || []).map(String);
      const newStockistIds = (company.stockists || []).map(String);

      const toAdd = newStockistIds.filter((sid) => !oldStockistIds.includes(sid));

      if (toAdd.length > 0) {
        await Stockist.updateMany(
          { _id: { $in: toAdd } },
          { $addToSet: { companies: company._id, companyNames: company.name } },
        );
      }

      // If the company name changed, update all linked stockists without removing any.
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



