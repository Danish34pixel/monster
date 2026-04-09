const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const { authenticate, isAdmin } = require("../middleware/auth");

// GET /api/company - list companies
router.get("/", companyController.getCompanies);

// POST /api/company - create a new company (admin only)
// Allow public create for companies (no auth) per developer request.
router.post("/", companyController.createCompany);

module.exports = router;
