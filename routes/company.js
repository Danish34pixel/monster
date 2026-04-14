const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const { authenticate, isAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { companyCreateSchema } = require("../validation/schemas");

router.get("/", companyController.getCompanies);
router.post("/", authenticate, (req, res, next) => {
  // Allow all primary roles to create companies to avoid blocking legitimate users
  const allowedRoles = ["admin", "stockist", "purchaser", "user"];
  if (allowedRoles.includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Access denied. Insufficient privileges.",
  });
}, validateBody(companyCreateSchema), companyController.createCompany);

module.exports = router;
