const required = ["NODE_ENV", "MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"];

let ok = true;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    ok = false;
  }
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 chars");
  ok = false;
}

if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
  console.error("JWT_REFRESH_SECRET must be at least 32 chars");
  ok = false;
}

if (process.env.NODE_ENV !== "production") {
  console.warn(`NODE_ENV is '${process.env.NODE_ENV}'. Expected 'production' for deploy.`);
}

if (!ok) process.exit(1);
console.log("Preflight passed: required production env configuration looks valid.");
