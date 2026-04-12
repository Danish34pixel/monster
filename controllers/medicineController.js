const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");

exports.getMedicines = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = Number.parseInt(page, 10) || 1;
    limit = Math.min(100, Number.parseInt(limit, 10) || 10);

    const totalMedicines = await Medicine.countDocuments();
    const data = await Medicine.find()
      .select("name genericName manufacturer price company stockists stockist seller active createdAt updatedAt")
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
    return res.status(500).json({ success: false, message: "Failed to fetch medicines" });
  }
};

exports.createMedicineQuick = async (req, res) => {
  try {
    const payload = {
      name: req.body.name,
      genericName: req.body.genericName,
      manufacturer: req.body.manufacturer,
      price: req.body.price,
      active: typeof req.body.active === "boolean" ? req.body.active : true,
    };

    if (req.body.company && mongoose.Types.ObjectId.isValid(req.body.company)) {
      payload.company = req.body.company;
    }

    const medicine = await Medicine.create(payload);
    return res.status(201).json({
      success: true,
      data: {
        _id: medicine._id,
        name: medicine.name,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
        price: medicine.price,
        company: medicine.company,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to create medicine" });
  }
};
