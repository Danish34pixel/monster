const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { authenticate, isAdmin } = require("../middleware/auth");

// Public list and get
router.get("/", userController.list);
router.get("/:id", userController.get);

// Admin actions (approve/decline). Authentication/authorization middleware can be added as needed.
router.patch("/:id/approve", authenticate, isAdmin, userController.approve);
router.patch("/:id/decline", authenticate, isAdmin, userController.decline);

module.exports = router;
