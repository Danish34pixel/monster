const EventLog = require("../models/EventLog");

// Fire-and-forget; never throws — audit logs must not break the main request
const logEvent = (userId, userModel, eventType, metadata = {}) => {
  EventLog.create({ userId, userModel, eventType, metadata }).catch((err) =>
    console.error("[EventLog] write failed:", err.message)
  );
};

module.exports = { logEvent };
