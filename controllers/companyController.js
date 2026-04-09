const Company = require("../models/Company");

exports.getCompanies = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Number.parseInt(page, 10) || 1;
    limit = Math.min(100, Number.parseInt(limit, 10) || 10);

    const totalCompanies = await Company.countDocuments();
    const data = await Company.find()
      .select("name description active createdAt updatedAt")
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
    const payload = {
      name: req.body.name,
      description: req.body.description,
      active: typeof req.body.active === "boolean" ? req.body.active : true,
    };

    const company = await Company.create(payload);
    return res.status(201).json({
      success: true,
      data: {
        _id: company._id,
        name: company.name,
        description: company.description,
        active: company.active,
      },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "Company already exists" });
    }
    return res.status(500).json({ success: false, message: "Failed to create company" });
  }
};
