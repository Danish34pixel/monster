const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const { authenticate, isAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { companyCreateSchema } = require("../validation/schemas");

router.get("/", companyController.getCompanies);
router.post("/", authenticate, isAdmin, validateBody(companyCreateSchema), companyController.createCompany);

module.exports = router;
