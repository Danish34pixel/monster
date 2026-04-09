const express = require("express");
const router = express.Router();
const purchasingCardController = require("../controllers/purchasingCardController");

// POST /api/purchasing-card/request -> create request
router.post("/request", purchasingCardController.createRequest);

// GET /api/purchasing-card/requests -> list
router.get("/requests", purchasingCardController.listRequests);

// GET /api/purchasing-card/approve-link/:id/:stockistId -> approve via email link
router.get(
  "/approve-link/:id/:stockistId",
  purchasingCardController.approveViaLink
);

// POST /api/purchasing-card/approve/:id -> approve by stockist (pass stockistId in body)
router.post("/approve/:id", purchasingCardController.approve);

module.exports = router;
