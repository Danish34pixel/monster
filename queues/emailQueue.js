// Minimal in-process email queue fallback to avoid Redis/BullMQ dependency.
// The queue API exposes `add(name, data, opts)` and processes jobs
// immediately by calling a user-supplied handler (set via `setProcessor`).

let processor = null;

const emailQueue = {
  async add(name, data, opts = {}) {
    // Immediately process jobs for the in-process fallback. Call the
    // registered processor if available.
    try {
      if (processor) {
        // Simulate a BullMQ job object minimally
        const job = { id: Date.now().toString(), name, data, opts };
        const result = await processor(job);
        return { id: job.id, returnvalue: result };
      }
      // No processor registered; just return a resolved job-like object
      return { id: Date.now().toString(), returnvalue: null };
    } catch (err) {
      // rethrow to preserve semantics
      throw err;
    }
  },
  // Allows worker code to register a processing function
  setProcessor(fn) {
    processor = fn;
  },
};

// No external Redis connection in fallback mode
const connection = null;

module.exports = { emailQueue, connection };
