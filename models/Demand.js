const mongoose = require("mongoose");

const DemandLineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number, default: 1, min: 1 },
    matchedMedicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", default: null },
    matchedMedicineName: { type: String, default: null },
    // Arrays because multiple stockists can carry the same item — every
    // stockist that matched gets notified (see demandDistributionService).
    assignedStockistIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Stockist" }],
    assignedStockistNames: [{ type: String, trim: true }],
    status: { type: String, enum: ["unmatched", "matched", "assigned"], default: "unmatched" },
  },
  { _id: false }
);

const DemandSchema = new mongoose.Schema(
  {
    purchaserId: { type: String, trim: true, default: null },
    purchaserName: { type: String, trim: true, default: null },
    lines: [DemandLineSchema],
    inventorySnapshot: [
      {
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", default: null },
        medicineName: String,
        requestedAs: String,
        stockists: [
          {
            id: { type: mongoose.Schema.Types.ObjectId, ref: "Stockist" },
            name: String,
            phone: String,
          },
        ],
      },
    ],
    note: { type: String, trim: true, maxlength: 500 },
  },
  { strict: true, timestamps: true }
);

module.exports = mongoose.model("Demand", DemandSchema);
