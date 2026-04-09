require("dotenv").config();
const Redis = require("ioredis");

async function tryConnect(name, ctorArgs, opts = {}) {
  console.log(`\n=== Trying: ${name} ===`);
  let client;
  try {
    if (typeof ctorArgs === "string") {
      client = new Redis(ctorArgs, { lazyConnect: true, ...opts });
    } else {
      client = new Redis({ ...ctorArgs, lazyConnect: true, ...opts });
    }

    client.on("error", (e) =>
      console.error(`${name} client error:`, e && e.message)
    );
    await client.connect();
    console.log(`${name} connected`);
    const key = `probe:${Date.now()}`;
    await client.set(key, "ok");
    const v = await client.get(key);
    console.log(`${name} GET ${key} ->`, v);
    await client.quit();
    return true;
  } catch (err) {
    console.error(`${name} failed:`, err && err.message);
    try {
      if (client) await client.quit();
    } catch (e) {}
    return false;
  }
}

(async () => {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT
    ? Number(process.env.REDIS_PORT)
    : undefined;
  const username = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD || undefined;
  const url = process.env.REDIS_URL; // may be rediss://...
  if (!url && (!host || !port || !username)) {
    console.error(
      "Redis probe requires REDIS_URL or REDIS_HOST/REDIS_PORT/REDIS_USERNAME to be set in environment."
    );
    process.exit(2);
  }

  if (url) {
    await tryConnect("URL (as-is)", url, {
      tls: { rejectUnauthorized: false },
    });
  }

  // Try host/port with TLS enabled
  await tryConnect("host+port TLS", {
    host,
    port,
    username,
    password,
    tls: {},
  });

  // Try host/port TLS with rejectUnauthorized=false
  await tryConnect(
    "host+port TLS (insecure cert check)",
    { host, port, username, password },
    { tls: { rejectUnauthorized: false } }
  );

  // Try host/port without TLS
  await tryConnect("host+port plain", { host, port, username, password });

  console.log("\nProbe complete");
  process.exit(0);
})();
