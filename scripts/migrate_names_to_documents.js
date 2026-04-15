const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Company = require("../models/Company");
const Medicine = require("../models/Medicine");
const Stockist = require("../models/Stockist");

async function migrate() {
  const mongoUri =
    process.env.MONGO_URI || "mongodb://localhost:27017/meditrap";
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    console.log("Connected to MongoDB.");

    const companies = await Company.find({
      $or: [
        { stockistNames: { $exists: false } },
        { stockistNames: { $size: 0 } },
      ],
    }).lean();

    for (const company of companies) {
      const stockistIds = Array.isArray(company.stockists)
        ? company.stockists.filter((id) =>
            mongoose.Types.ObjectId.isValid(String(id)),
          )
        : [];
      if (stockistIds.length === 0) continue;

      const stockistDocs = await Stockist.find({ _id: { $in: stockistIds } })
        .select("name")
        .lean();
      const stockistNames = stockistDocs
        .map((doc) => doc.name)
        .filter((name) => typeof name === "string" && name.trim())
        .map((name) => name.trim());

      if (stockistNames.length > 0) {
        await Company.findByIdAndUpdate(company._id, {
          stockistNames: Array.from(new Set(stockistNames)),
        });
        console.log(
          `Updated Company ${company._id} stockistNames: ${stockistNames.join(", ")}`,
        );
      }
    }

    const medicines = await Medicine.find({
      $or: [
        { companyName: { $exists: false } },
        { companyName: "" },
        { stockistNames: { $exists: false } },
      ],
    }).lean();

    for (const medicine of medicines) {
      const updateFields = {};

      if (!medicine.companyName && medicine.company) {
        const company = await Company.findById(medicine.company)
          .select("name")
          .lean();
        if (company?.name) {
          updateFields.companyName = company.name;
        }
      }

      const stockistIds = Array.isArray(medicine.stockists)
        ? medicine.stockists.filter((id) =>
            mongoose.Types.ObjectId.isValid(String(id)),
          )
        : [];
      if (stockistIds.length > 0) {
        const stockistDocs = await Stockist.find({ _id: { $in: stockistIds } })
          .select("name")
          .lean();
        const resolvedNames = new Set(
          Array.isArray(medicine.stockistNames) ? medicine.stockistNames : [],
        );
        stockistDocs.forEach((doc) => {
          if (doc?.name) resolvedNames.add(doc.name.trim());
        });
        if (resolvedNames.size > 0) {
          updateFields.stockistNames = Array.from(resolvedNames);
        }
      }

      if (Object.keys(updateFields).length > 0) {
        await Medicine.findByIdAndUpdate(medicine._id, updateFields);
        console.log(
          `Updated Medicine ${medicine._id} fields: ${Object.keys(updateFields).join(", ")}`,
        );
      }
    }

    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

migrate();
