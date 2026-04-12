const express = require("express");
const router = express.Router();
const medicineController = require("../controllers/medicineController");
const { authenticate, isAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { medicineCreateSchema } = require("../validation/schemas");

router.get("/", medicineController.getMedicines);
router.post("/quick", authenticate, isAdmin, validateBody(medicineCreateSchema), medicineController.createMedicineQuick);

module.exports = router;
