const express = require("express");
const { authenticate, isAdmin } = require("../middleware/auth");
const {
  pendingUsers,
  verifyUser,
  rejectUser,
  userTimeline,
} = require("../controllers/adminController");

const router = express.Router();

router.use(authenticate, isAdmin);

router.get("/pending-users", pendingUsers);
router.post("/verify-user/:id", verifyUser);
router.post("/reject-user/:id", rejectUser);
router.get("/users/:id/timeline", userTimeline);

module.exports = router;
