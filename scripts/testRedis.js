require("dotenv").config();
const Redis = require("ioredis");

(async () => {
  const envUrl = process.env.REDIS_URL;
  let client;
  if (envUrl) {
    client = new Redis(envUrl, { lazyConnect: true });
  } else {
    // Don't fall back to embedded secrets in source. Require explicit env vars.
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT
      ? Number(process.env.REDIS_PORT)
      : undefined;
    const username = process.env.REDIS_USERNAME;
    const password = process.env.REDIS_PASSWORD;
    if (!host || !port || !username || !password) {
      console.error(
        "Redis configuration incomplete. Please set REDIS_URL or REDIS_HOST, REDIS_PORT, REDIS_USERNAME and REDIS_PASSWORD in your environment."
      );
      process.exit(2);
    }

    client = new Redis({
      host,
      port,
      username,
      password,
      tls: process.env.REDIS_TLS === "true" ? {} : undefined,
      lazyConnect: true,
    });
  }

  client.on("error", (err) =>
    console.error("Redis Client Error", err && err.message)
  );

  try {
    await client.connect();
    console.log("Connected to Redis");
    await client.set("foo", "bar");
    const result = await client.get("foo");
    console.log("GET foo ->", result);
    await client.quit();
    process.exit(0);
  } catch (err) {
    console.error("Redis connection failed:", err && err.message);
    try {
      await client.quit();
    } catch (e) {}
    process.exit(2);
  }
})();
