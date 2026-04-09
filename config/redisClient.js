const Redis = require("ioredis");

// Create a Redis client following the project's existing env conventions.
// We use lazyConnect to avoid blocking startup; callers can use the
// exported `client` and call connect() if they want. However server.js
// requires this file for side-effects so we attempt a best-effort connect.

let client;
try {
  if (process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  } else {
    const host = process.env.REDIS_HOST || "127.0.0.1";
    const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
    const username = process.env.REDIS_USERNAME || undefined;
    const password = process.env.REDIS_PASSWORD || undefined;
    const useTls =
      String(process.env.REDIS_TLS || "false").toLowerCase() === "true";

    const opts = { host, port, username, password };
    if (useTls) opts.tls = {};
    client = new Redis(opts);
  }

  client.on("error", (err) => {
    console.error("Redis Client Error", err && err.message);
  });

  // Try to connect but don't crash the process if Redis is unavailable.
  (async () => {
    try {
      if (client && client.connect) {
        await client.connect();
        console.log("Connected to Redis");
      }
    } catch (e) {
      console.warn(
        "Redis connection failed on startup (continuing without Redis):",
        e && e.message
      );
    }
  })();
} catch (e) {
  console.warn("Failed to initialize Redis client:", e && e.message);
}

module.exports = client;
