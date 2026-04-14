const Stockist = require("../models/Stockist");
const Medicine = require("../models/Medicine");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeItemName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function extractSupplierItems(supplier) {
  const names = [];

  // Check all common inventory fields
  const fields = [
    "availableItems",
    "medicines",
    "Medicines",
    "items",
    "companies",
  ];

  for (const field of fields) {
    if (Array.isArray(supplier[field])) {
      for (const it of supplier[field]) {
        if (!it) continue;
        if (typeof it === "string") {
          const n = normalizeItemName(it);
          if (n) names.push(n);
        } else if (typeof it === "object") {
          // Handle common object structures
          const n = normalizeItemName(it.name || it.medicineName || it.label || it.shortName || it.brandName || "");
          if (n) names.push(n);
        }
      }
    }
  }

  return new Set(names);
}

async function distributeDemand(demand = {}, options = {}) {
  const rawItems = Array.isArray(demand.items) ? demand.items : [];
  const assignToAllSuppliers =
    options.assignToAllSuppliers !== undefined
      ? Boolean(options.assignToAllSuppliers)
      : true;

  const dedupedItems = [];
  const seen = new Set();
  for (const item of rawItems) {
    const name = String(item && item.name ? item.name : "").trim();
    const normalized = normalizeItemName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    dedupedItems.push({ name, normalized });
  }

  if (dedupedItems.length === 0) {
    return {
      supplierDemands: [],
      inventory: [],
      unfulfilledItems: [],
      itemsRequested: 0,
      matchedItems: 0,
      suppliersInvolved: 0,
      assignToAllSuppliers,
    };
  }

  // 1. Resolve items against the global Medicine catalog
  const catalogMedicines = await Medicine.find({ active: { $ne: false } })
    .select("name _id")
    .lean();

  const resolvedItems = dedupedItems.map((it) => {
    const q = it.normalized;
    // Simple catalog matching logic
    const match =
      catalogMedicines.find((m) => normalizeItemName(m.name) === q) ||
      catalogMedicines.find((m) => normalizeItemName(m.name).includes(q)) ||
      catalogMedicines.find((m) => q.includes(normalizeItemName(m.name)));

    return {
      requestedAs: it.name,
      normalizedRequested: it.normalized,
      medicineName: match ? match.name : it.name,
      normalizedMedicine: normalizeItemName(match ? match.name : it.name),
      medicineId: match ? match._id : null,
      inCatalog: !!match,
    };
  });

  // 2. Find all approved stockists to check their inventory
  const suppliers = await Stockist.find({
    approved: true,
    status: "approved",
  })
    .select("_id name contactPerson phone medicines Medicines availableItems items companies cntxNumber contactNo")
    .lean();

  const supplierCatalog = suppliers.map((s) => ({
    supplierId: s._id,
    supplierName: s.name || "Unnamed Supplier",
    phone: s.phone || s.cntxNumber || s.contactNo || "N/A",
    itemsSet: extractSupplierItems(s),
  }));

  const supplierBuckets = new Map();
  const inventoryMapping = [];
  const unfulfilledItems = [];
  let matchedCount = 0;

  // 3. Match each resolved item against supplier catalogs
  for (const item of resolvedItems) {
    const matches = supplierCatalog.filter((s) => {
      // Use fuzzy matching: if the stockist has a medicine that encompasses the search term or vice versa
      for (const sItem of s.itemsSet) {
        if (
          sItem === item.normalizedMedicine ||
          sItem === item.normalizedRequested ||
          sItem.includes(item.normalizedMedicine) ||
          item.normalizedMedicine.includes(sItem) ||
          sItem.includes(item.normalizedRequested) ||
          item.normalizedRequested.includes(sItem)
        ) {
          return true;
        }
      }
      return false;
    });

    if (matches.length === 0) {
      unfulfilledItems.push({ name: item.requestedAs });
      inventoryMapping.push({
        medicineName: item.medicineName,
        requestedAs: item.requestedAs,
        stockists: [],
      });
      continue;
    }

    matchedCount += 1;
    
    // Inventory view (Medicine -> Stockists)
    inventoryMapping.push({
      medicineName: item.medicineName,
      requestedAs: item.requestedAs,
      stockists: matches.map(m => ({
        id: m.supplierId,
        name: m.name || m.supplierName,
        phone: m.phone
      }))
    });

    // Supplier view (Stockist -> Items)
    const selected = assignToAllSuppliers ? matches : [matches[0]];
    for (const supplier of selected) {
      const key = String(supplier.supplierId);
      const existing = supplierBuckets.get(key) || {
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        items: [],
        status: "pending",
      };
      existing.items.push({ name: item.medicineName });
      supplierBuckets.set(key, existing);
    }
  }

  const supplierDemands = Array.from(supplierBuckets.values());

  return {
    supplierDemands,
    inventory: inventoryMapping,
    unfulfilledItems,
    itemsRequested: dedupedItems.length,
    matchedItems: matchedCount,
    suppliersInvolved: supplierDemands.length,
    assignToAllSuppliers,
  };
}

module.exports = {
  distributeDemand,
};

