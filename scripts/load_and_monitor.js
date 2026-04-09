// Simple load generator + RPS monitor for local testing
// Usage: node load_and_monitor.js [target] [concurrency] [durationSeconds]
// Example: node load_and_monitor.js http://localhost:5000 50 10

const http = require("http");
const { URL } = require("url");

const target = process.argv[2] || "http://localhost:5000";
const concurrency = Number(process.argv[3] || 50);
const duration = Number(process.argv[4] || 10); // seconds

const targetUrl = new URL(target);
const healthPath = "/health";
const metricsPath = "/metrics/rps";

let stop = false;

function fireRequest(path) {
  return new Promise((resolve) => {
    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
      path,
      method: "GET",
    };
    const req = http.request(opts, (res) => {
      // drain
      res.on("data", () => {});
      res.on("end", () => resolve());
    });
    req.on("error", () => resolve());
    req.end();
  });
}

async function startLoad() {
  console.log(
    `Starting load: target=${target} concurrency=${concurrency} duration=${duration}s`
  );
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (!stop) {
          await fireRequest(healthPath);
          // tiny backoff to avoid tight loop
          await new Promise((r) => setTimeout(r, 1));
        }
      })()
    );
  }
  return Promise.all(workers);
}

async function pollMetrics() {
  const startTs = Date.now();
  while (!stop) {
    try {
      const res = await new Promise((resolve, reject) => {
        const opts = {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
          path: metricsPath,
          method: "GET",
          timeout: 2000,
        };
        const req = http.request(opts, (res) => {
          let body = "";
          res.on("data", (d) => (body += d.toString()));
          res.on("end", () => resolve({ statusCode: res.statusCode, body }));
        });
        req.on("error", (e) => reject(e));
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.end();
      });
      if (res && res.body) {
        try {
          const json = JSON.parse(res.body);
          console.log(
            new Date().toISOString(),
            "lastSecond=",
            json.lastSecond,
            "avg=",
            json.averagePerSecond
          );
        } catch (e) {
          console.log("metrics parse error", e && e.message);
        }
      }
    } catch (e) {
      console.log("metrics request failed", e && e.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
    if ((Date.now() - startTs) / 1000 >= duration) stop = true;
  }
}

(async () => {
  const monitor = pollMetrics();
  const load = startLoad();
  await Promise.all([monitor, load]);
  console.log("Load test finished");
  process.exit(0);
})();
