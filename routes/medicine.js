const express = require("express");
const router = express.Router();
const medicineController = require("../controllers/medicineController");
const {
  authenticate,
  optionalAuthenticate,
  isAdmin,
} = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { medicineCreateSchema } = require("../validation/schemas");

router.get("/", medicineController.getMedicines);
router.post(
  "/",
  authenticate,
  isAdmin,
  validateBody(medicineCreateSchema),
  medicineController.createMedicine,
);
router.post(
  "/quick",
  optionalAuthenticate,
  validateBody(medicineCreateSchema),
  medicineController.createMedicineQuick,
);

module.exports = router;
