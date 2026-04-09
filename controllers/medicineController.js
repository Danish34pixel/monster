const Medicine = require("../models/Medicine");

exports.getMedicines = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    // Count total medicines
    const totalMedicines = await Medicine.countDocuments();

    // Fetch paginated medicines
    const data = await Medicine.find()
      .sort({ createdAt: -1 }) // newest first
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalMedicines / limit),
      totalMedicines,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("getMedicines error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Quick create for medicine (admin only)
exports.createMedicineQuick = async (req, res) => {
  try {
    const payload = req.body || {};
    const name = payload.name || payload.title || payload.medicineName;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Medicine name is required." });
    }

    const medicine = new Medicine(payload);
    await medicine.save();
    res.status(201).json({ success: true, data: medicine });
  } catch (err) {
    console.error("createMedicineQuick error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
