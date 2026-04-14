const Company = require("../models/Company");
const Stockist = require("../models/Stockist");

exports.getCompanies = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Number.parseInt(page, 10) || 1;
    limit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 10));

    const totalCompanies = await Company.countDocuments();
    const data = await Company.find()
      .select("name description active stockists createdAt updatedAt")
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
    return res.status(500).json({ success: false, message: "Failed to fetch companies" });
  }
};

exports.createCompany = async (req, res) => {
  try {
    const { name, description, active, stockists } = req.body;
    
    // 1. Create the company
    const payload = {
      name,
      description,
      active: typeof active === "boolean" ? active : true,
      stockists: Array.isArray(stockists) ? stockists : [],
    };

    const company = await Company.create(payload);
    
    // DEBUG: Log creation success
    try {
      require('fs').appendFileSync('db_debug.txt', `[${new Date().toISOString()}] Created company: ${company.name} (${company._id})\n`);
    } catch(e) {}

    let updateResult = null;
    // 2. If stockists are provided, update each stockist to link back to this company
    if (payload.stockists.length > 0) {
      updateResult = await Stockist.updateMany(
        { _id: { $in: payload.stockists } },
        { $addToSet: { companies: company._id } }
      );
      
      // DEBUG: Log update result
      try {
        require('fs').appendFileSync('db_debug.txt', `[${new Date().toISOString()}] Linked to ${updateResult.modifiedCount}/${payload.stockists.length} stockists.\n`);
      } catch(e) {}
    }

    return res.status(201).json({
      success: true,
      data: {
        _id: company._id,
        name: company.name,
        description: company.description,
        active: company.active,
        stockists: company.stockists,
      },
      updateResult,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "Company already exists" });
    }
    return res.status(500).json({ success: false, message: "Failed to create company" });
  }
};
