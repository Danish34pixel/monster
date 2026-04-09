const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { authenticate, isAdmin } = require("../middleware/auth");

router.use(authenticate, isAdmin);
router.get("/", userController.list);
router.get("/:id", userController.get);
router.patch("/:id/approve", userController.approve);
router.patch("/:id/decline", userController.decline);

module.exports = router;
