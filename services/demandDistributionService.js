const Stockist = require("../models/Stockist");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeItemName(name) {
  return String(name || "").trim().toLowerCase();
}

function extractSupplierItems(supplier) {
  const names = [];

  if (Array.isArray(supplier.availableItems)) {
    for (const it of supplier.availableItems) {
      const n = normalizeItemName(it && it.name);
      if (n) names.push(n);
    }
  }

  if (Array.isArray(supplier.medicines)) {
    for (const n of supplier.medicines) {
      const v = normalizeItemName(n);
      if (v) names.push(v);
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

  const deduped = [];
  const seen = new Set();
  for (const item of rawItems) {
    const name = String(item && item.name ? item.name : "").trim();
    const normalized = normalizeItemName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push({ name, normalized });
  }

  if (deduped.length === 0) {
    return {
      supplierDemands: [],
      unfulfilledItems: [],
      itemsRequested: 0,
      matchedItems: 0,
      suppliersInvolved: 0,
      assignToAllSuppliers,
    };
  }

  const patterns = deduped.map((it) => new RegExp(`^${escapeRegex(it.name)}$`, "i"));

  const suppliers = await Stockist.find({
    approved: true,
    status: "approved",
    $or: [
      { medicines: { $in: patterns } },
      { "availableItems.name": { $in: patterns } },
    ],
  })
    .select("_id name medicines availableItems")
    .lean();

  const supplierCatalog = suppliers.map((s) => ({
    supplierId: s._id,
    supplierName: s.name || "Unnamed Supplier",
    itemsSet: extractSupplierItems(s),
  }));

  const supplierBuckets = new Map();
  const unfulfilledItems = [];
  let matchedItems = 0;

  for (const item of deduped) {
    const matches = supplierCatalog.filter((s) => s.itemsSet.has(item.normalized));
    if (matches.length === 0) {
      unfulfilledItems.push({ name: item.name });
      continue;
    }

    matchedItems += 1;
    const selected = assignToAllSuppliers ? matches : [matches[0]];
    for (const supplier of selected) {
      const key = String(supplier.supplierId);
      const existing = supplierBuckets.get(key) || {
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        items: [],
        status: "pending",
      };
      existing.items.push({ name: item.name });
      supplierBuckets.set(key, existing);
    }
  }

  const supplierDemands = Array.from(supplierBuckets.values());

  return {
    supplierDemands,
    unfulfilledItems,
    itemsRequested: deduped.length,
    matchedItems,
    suppliersInvolved: supplierDemands.length,
    assignToAllSuppliers,
  };
}

module.exports = {
  distributeDemand,
};

