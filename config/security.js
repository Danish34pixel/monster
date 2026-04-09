const REQUIRED_ENV = ["JWT_SECRET", "JWT_REFRESH_SECRET"];

for (const key of REQUIRED_ENV) {
  const value = process.env[key];
  if (!value || value.length < 32) {
    throw new Error(`${key} must be set and at least 32 characters long`);
  }
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  ACCESS_TOKEN_TTL: process.env.JWT_ACCESS_EXPIRES || "15m",
  REFRESH_TOKEN_TTL: process.env.JWT_REFRESH_EXPIRES || "7d",
};
