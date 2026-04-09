const Company = require("../models/Company");

exports.getCompanies = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const totalCompanies = await Company.countDocuments();
    const data = await Company.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalCompanies / limit),
      totalCompanies,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("getCompanies error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Create a new company (admin only)
exports.createCompany = async (req, res) => {
  try {
    const payload = req.body || {};
    const name = payload.name || payload.title || payload.companyName;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Company name is required." });
    }

    const company = new Company(payload);
    await company.save();
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    console.error("createCompany error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
