// // const express = require("express");
// const router = express.Router();
// const {
//   upload: uploadAadhar,
//   cleanupUploads,
// } = require("../middleware/upload");
// const purchaserController = require("../controllers/purchaserController");
// const { authenticate } = require("../middleware/auth");
// // sanitizers removed per user request
// let xss = (req, res, next) => next();
// try {
//   // xss-clean is optional in some deployments; if it's installed use it,
//   // otherwise fall back to a no-op to avoid crashing the route require step.
//   // This keeps the route functional even if the package isn't present.
//   // eslint-disable-next-line global-require
//   xss = require("xss-clean");
// } catch (e) {
//   console.warn(
//     "Optional middleware xss-clean not available, continuing without it."
//   );
// }

// // POST /api/purchaser - create purchaser with aadhar image
// // Accept both aadharImage and photo
// // Allow anonymous creation: purchaser creation is a public action (uploads handled server-side)
// router.post(
//   "/",
//   uploadAadhar.fields([
//     { name: "aadharImage", maxCount: 1 },
//     { name: "photo", maxCount: 1 },
//   ]),
//   // Ensure temp uploads are removed after response
//   cleanupUploads,
//   // Apply XSS cleanup if available (no-op otherwise)
//   (req, res, next) => xss(req, res, next),
//   purchaserController.createPurchaser
// );

// // GET /api/purchaser - get all purchasers (scoped to user unless admin)
// router.get("/", authenticate, purchaserController.getPurchasers);

// // GET /api/purchaser/:id - get purchaser details (no auth required for read)
// router.get("/:id", purchaserController.getPurchaser);

// // DELETE /api/purchaser/:id - delete purchaser by id (auth required)
// router.delete("/:id", authenticate, purchaserController.deletePurchaser);

// module.exports = router;
const express = require("express");
const router = express.Router();
const purchaserController = require("../controllers/purchaserController");
const { authenticate } = require("../middleware/auth");
const {
  upload: uploadAadhar,
  cleanupUploads,
} = require("../middleware/upload");

// Create Purchaser
router.post(
  "/",
  uploadAadhar.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  cleanupUploads,
  purchaserController.createPurchaser
);

// Login
router.post("/login", purchaserController.loginPurchaser);

// Protected routes
router.get("/", authenticate, purchaserController.list);
router.get("/:id", purchaserController.get);   // public: purchaser reads own profile by ID
router.delete("/:id", authenticate, purchaserController.delete);

module.exports = router;
