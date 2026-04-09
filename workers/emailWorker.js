const { sendMail } = require("../utils/mailer");
const { emailQueue, connection } = require("../queues/emailQueue");

// If a Redis/BullMQ connection exists we would use Worker. Since we've
// removed Redis from this deployment by default, support an in-process
// fallback where jobs are processed immediately.
let workerExport = null;

if (connection) {
  // If Redis/BullMQ is available in some deployments, keep the original
  // behavior by creating a Worker. Require lazily to avoid pulling in
  // BullMQ when it's unused.
  try {
    const { Worker } = require("bullmq");
    const worker = new Worker(
      "emailQueue",
      async (job) => {
        const { to, subject, html, text, from } = job.data;
        try {
          const result = await sendMail({ to, subject, html, text, from });
          if (result && result.previewUrl)
            console.log("Email preview URL:", result.previewUrl);
          return { ok: true };
        } catch (err) {
          console.error("emailWorker: failed to send", err && err.message);
          throw err;
        }
      },
      {
        connection,
        concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY) || 5,
      }
    );

    worker.on("failed", (job, err) => {
      console.error(`Job ${job.id} failed:`, err && err.message);
    });

    worker.on("completed", (job) => {
      console.log(`Job ${job.id} completed`);
    });

    console.log("Email worker started (BullMQ)");
    workerExport = worker;
  } catch (e) {
    console.warn(
      "Failed to start BullMQ worker, falling back to in-process processor:",
      e && e.message
    );
  }
}

if (!workerExport) {
  // Register a processor with the in-process queue: it will call sendMail
  // directly when a job is added (emailQueue.add).
  emailQueue.setProcessor(async (job) => {
    const { to, subject, html, text, from } = job.data || {};
    try {
      const result = await sendMail({ to, subject, html, text, from });
      if (result && result.previewUrl)
        console.log("Email preview URL:", result.previewUrl);
      // simulate BullMQ successful return
      return { ok: true };
    } catch (err) {
      console.error(
        "emailWorker (in-process): failed to send",
        err && err.message
      );
      // throw to preserve semantics for callers that expect an exception
      throw err;
    }
  });

  console.log("Email worker active (in-process fallback)");
  workerExport = { inProcess: true };
}

module.exports = workerExport;
