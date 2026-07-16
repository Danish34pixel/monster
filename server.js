// directory first (Backend/), then fall back to the process cwd. This
// avoids issues when nodemon or scripts run from the repository root.
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const envCandidates = [
  path.join(__dirname, "config.env"),
  path.join(__dirname, ".env"),
  path.join(process.cwd(), "config.env"),
  path.join(process.cwd(), ".env"),
];

let loaded = false;
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    console.log(`Loaded environment from ${p}`);
    loaded = true;
    break;
  }
}

if (!loaded) {
  // No env file found in Backend or current working dir. Still call dotenv
  // (no-op) to keep behavior consistent, but warn the user.
  dotenv.config();
  console.warn(
    "No config.env or .env file found in Backend or current working directory. Environment variables may be missing.",
  );
}
const isDevelopment =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV !== "production";
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const crypto = require("crypto");

const useLocalHttps =
  String(
    process.env.USE_HTTPS || process.env.HTTPS || "false",
  ).toLowerCase() === "true";
const sslKeyPath = String(
  process.env.SSL_KEY_PATH || process.env.SSL_KEY || "",
).trim();
const sslCertPath = String(
  process.env.SSL_CERT_PATH || process.env.SSL_CERT || "",
).trim();
const sslCaPath = String(
  process.env.SSL_CA_PATH || process.env.SSL_CA || "",
).trim();

const loadSslCredentials = () => {
  if (!sslKeyPath || !sslCertPath) return null;
  try {
    const credentials = {
      key: fs.readFileSync(path.resolve(sslKeyPath), "utf8"),
      cert: fs.readFileSync(path.resolve(sslCertPath), "utf8"),
    };
    if (sslCaPath) {
      credentials.ca = fs.readFileSync(path.resolve(sslCaPath), "utf8");
    }
    return credentials;
  } catch (err) {
    console.warn("Unable to load SSL credentials for HTTPS:", err.message);
    return null;
  }
};

const sslCredentials = loadSslCredentials();

// Import routes (case-robust): try multiple casings and fall back to a stub router

const tryRequireRoute = (basePath) => {
  const variants = [
    basePath,
    basePath.toLowerCase(),
    basePath[0].toUpperCase() + basePath.slice(1),
  ];
  for (const v of variants) {
    try {
      // Attempt require relative to this file
      return require(`./routes/${v}`);
    } catch (err) {
      if (
        err.code !== "MODULE_NOT_FOUND" ||
        !err.message.includes(`./routes/${v}`)
      ) {
        console.error(`Error loading route ./routes/${v}:`, err);
      }
      // continue trying other variants
    }
    try {
      // Attempt alternate relative path (some shims use ../Backend/routes)
      return require(`../routes/${v}`);
    } catch (err) {
      if (
        err.code !== "MODULE_NOT_FOUND" ||
        !err.message.includes(`../routes/${v}`)
      ) {
        console.error(`Error loading route ../routes/${v}:`, err);
      }
      // continue
    }
  }

  // If none of the variants worked, return a harmless router that responds
  // with a 501 so the server doesn't crash on startup in deployments where
  // the file is missing or differently named.
  const stub = express.Router();
  stub.use((req, res) =>
    res.status(501).json({
      success: false,
      message: "Route not implemented on this deployment.",
    }),
  );
  return stub;
};

// Import route modules using the resilient helper
const authRoutes = tryRequireRoute("auth");
const purchaserRoutes = tryRequireRoute("Purchaser");
const stockistRoutes = tryRequireRoute("stockist");
const medicineRoutes = tryRequireRoute("medicine");
const companyRoutes = tryRequireRoute("company");
const staffRoutes = tryRequireRoute("staff");
const userRoutes = tryRequireRoute("user");
const migrationRoutes = tryRequireRoute("migration");
const purchasingCardRoutes = require("./routes/purchasingCard");
const demandRoutes = require("./routes/demand");
const urgentRequestRoutes = require("./routes/urgentRequest");
const adsRoutes = require("./routes/ads");
const announcementsRoutes = require("./routes/announcements");

// Import middleware
const { handleUploadError } = require("./middleware/upload");

const app = express();
app.set("trust proxy", 1);
mongoose.set("strictQuery", true);

if (
  process.env.NODE_ENV === "production" &&
  process.env.ENFORCE_HTTPS !== "0"
) {
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
    const isSecure = req.secure || forwardedProto.includes("https");
    if (isSecure) return next();
    return res.status(426).json({
      success: false,
      message: "HTTPS is required",
    });
  });
}

// Global security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    // 2000 per 15 min per IP — allows normal polling (5s interval = 180/15min)
    // plus admin panel reads without hitting the ceiling.
    max: Number(process.env.GLOBAL_RATE_LIMIT_MAX || 2000),
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// CORS configuration & middleware
// This must be placed BEFORE body parsers to ensure that even error responses
// from the body parser (like 413 Entity Too Large) include CORS headers.
const corsOptions = {
  // Allow the production frontend by default (Vercel URL). The FRONTEND_URL
  // environment variable can override this for other deployments.
  origin: [
    process.env.FRONTEND_URL || "https://medi-trap-frontend.vercel.app",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Robust origin echo middleware: read allowed origins from FRONTEND_URLS
// (comma-separated) or FRONTEND_URL (single).
const DEFAULT_FRONTEND = "https://medi-trap-frontend.vercel.app";
// Include common local dev origins only in development.
const DEV_FRONTENDS = [
  "http://localhost:5173",
  "http://localhost",
  "http://10.0.2.2:5000",
  "http://localhost:8081",
  "http://localhost:19000",
  "http://localhost:19006",
  "https://localhost:5173",
  "https://localhost:5002",
  "https://localhost:8081",
  "https://localhost:19000",
  "https://localhost:19006",
];
const rawFrontends =
  process.env.FRONTEND_URLS || process.env.FRONTEND_URL || DEFAULT_FRONTEND;
const allowedOrigins = new Set(
  // Start from the default, include common dev origins, and merge any environment-provided origins.
  [DEFAULT_FRONTEND]
    .concat(DEV_FRONTENDS)
    .concat(
      rawFrontends
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    // Normalize and dedupe
    .map((s) => s.replace(/\/+$/, "")),
);

// Dynamic CORS middleware: reflect the incoming Origin when allowed.
app.use(
  cors({
    origin: (origin, callback) => {
      // In development, allow all origins for convenience (local dev only)
      if (isDevelopment) return callback(null, true);
      // Allow non-browser requests (curl, server-to-server) with no Origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      // During development, allow common local-LAN origins (phone testing)
      try {
        // Accept origins like http://192.168.x.y(:port) or http://10.x.x.x(:port)
        const localLanRegex =
          /^https?:\/\/(?:192\.168|10|172\.(1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}(?::\d+)?$/;
        if (isDevelopment && localLanRegex.test(origin))
          return callback(null, true);
      } catch (e) {
        // ignore
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Manual CORS fallback for edge cases/errors where the 'cors' package logic might be skipped
app.use((req, res, next) => {
  const origin = req.headers.origin;
  let allowed = !origin || allowedOrigins.has(origin);
  if (!allowed && isDevelopment && origin) {
    try {
      const localLanRegex =
        /^https?:\/\/(?:192\.168|10|172\.(1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}(?::\d+)?$/;
      if (localLanRegex.test(origin)) allowed = true;
    } catch (e) {}
  }

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Debug: print allowed origins at startup
console.log("Allowed CORS origins:", Array.from(allowedOrigins));
global.__ALLOWED_ORIGINS__ = Array.from(allowedOrigins);

// Middleware
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
// Express 5 Compatibility Shim
// Express 5 makes req.query/req.params/req.body read-only getters in some contexts.
// express-mongo-sanitize needs to mutate them, so we make them writable here.
app.use((req, res, next) => {
  ["query", "body", "params"].forEach((prop) => {
    try {
      // Check if we can already write to it
      const descriptor = Object.getOwnPropertyDescriptor(req, prop);
      if (descriptor && descriptor.writable) return;

      const val = req[prop];

      // Attempt to redefine the property on the specific request instance
      Object.defineProperty(req, prop, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch (e) {
      // If it fails, we log it, but often it works even if getOwnPropertyDescriptor returns null (inherited)
      if (req[prop] !== undefined) {
        try {
          const val = req[prop];
          req[prop] = val; // Try direct assignment
        } catch (assignError) {
          // Final fallback: just try to force it
          try {
            Object.defineProperty(req, prop, {
              value: req[prop],
              writable: true,
            });
          } catch (f) {
            console.warn(`Shim unable to redefine req.${prop}:`, e.message);
          }
        }
      }
    }
  });
  next();
});

app.use(
  mongoSanitize({
    replaceWith: "_",
  }),
);
app.use(hpp());

// Serve uploads in all environments (required for ad media)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Legacy/root aliases for some frontend clients that call routes without the /api prefix.
// This preserves compatibility without changing the mounted API structure.
app.use((req, res, next) => {
  if (req.path === "/login") {
    req.url = "/api/auth/login" + (req.url.slice(req.path.length) || "");
  } else if (req.path === "/stockist" || req.path.startsWith("/stockist/")) {
    req.url = "/api" + req.url;
  }
  next();
});

// Routes
app.use("/api/auth", authRoutes);
// Mount purchaser routes
app.use("/api/purchaser", purchaserRoutes);
// Mount placeholder routes for frontend
app.use("/api/stockist", stockistRoutes);
app.use("/api/medicine", medicineRoutes);
app.use("/api/company", companyRoutes);
// Mount public user routes (list/get) and admin approve/decline endpoints
app.use("/api/user", userRoutes);
// Mount staff routes
app.use("/api/staff", staffRoutes);
// Mount migration routes (dry-run backfill)
app.use("/api/migration", migrationRoutes);
// Mount purchasing card request/grant endpoints
app.use("/api/purchasing-card", purchasingCardRoutes);
// Mount demand routes
app.use("/api/demand", demandRoutes);
// Mount urgent request routes
app.use("/api/urgent-request", urgentRequestRoutes);
// Mount ads routes
app.use("/api/ads", adsRoutes);
// Mount announcements routes
app.use("/api/announcements", announcementsRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "MedTrap Backend is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/test-version", (req, res) => {
  res.json({ version: "v4-verified-logic" });
});

// Development-only debug endpoints to inspect DB state quickly
if (isDevelopment || process.env.DEBUG_API === "1") {
  app.get("/api/debug/users", async (req, res) => {
    try {
      const supplied = String(req.headers["x-debug-token"] || "");
      const expected = String(process.env.DEBUG_TOKEN || "");
      if (!expected) {
        return res
          .status(403)
          .json({ success: false, message: "Debug token is not configured" });
      }
      const a = Buffer.from(supplied);
      const b = Buffer.from(expected);
      const isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!isValid) {
        return res
          .status(403)
          .json({ success: false, message: "Invalid debug token" });
      }

      // Lazy-require the model so this endpoint can be no-op in production builds
      const User = require("./models/User");
      const count = await User.countDocuments();
      const sample = await User.find().sort({ createdAt: -1 }).limit(10).lean();
      return res.json({ success: true, count, sample });
    } catch (e) {
      console.error("/api/debug/users error:", e && e.message);
      return res
        .status(500)
        .json({ success: false, message: "Debug endpoint failed" });
    }
  });
}

// Error handling middleware
app.use(handleUploadError);

app.use((error, req, res, next) => {
  if (error) {
    const isPayloadTooLarge =
      error.status === 413 ||
      error.type === "entity.too.large" ||
      (typeof error.message === "string" &&
        error.message.toLowerCase().includes("payload too large"));

    if (isPayloadTooLarge) {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization",
        );
      }

      return res.status(413).json({
        success: false,
        message:
          "Request too large. Reduce payload size or upload smaller files.",
      });
    }
  }

  console.error("Global error handler:", error);

  if (error && error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: Object.values(error.errors).map((err) => err.message),
    });
  }

  if (error && error.name === "MongoError" && error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: "Duplicate field value. This value already exists.",
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

// 404 handler (must be last, and avoid wildcard string)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// MongoDB connection
const connectDB = async () => {
  try {
    // Support multiple common environment variable names for the MongoDB URI.
    // This project historically referenced `MONGO_URI` in code but some
    // env files use `MONGODB_URI` or `DB_URI`. Accept any of them.
    const mongoUri =
      process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;

    if (!mongoUri || typeof mongoUri !== "string") {
      throw new Error(
        "MongoDB connection string not set. Please add MONGO_URI (or MONGODB_URI/DB_URI) to config.env or .env and restart.",
      );
    }

    console.log(
      `Using MongoDB URI from ${
        process.env.MONGO_URI
          ? "MONGO_URI"
          : process.env.MONGODB_URI
            ? "MONGODB_URI"
            : "DB_URI"
      }`,
    );

    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Start server
// For local testing it's sometimes convenient to call http://localhost/* (no port).
// Set FORCE_ROOT=1 in your .env and run with elevated privileges to bind to port 80.
const PORT = Number(
  process.env.PORT || (process.env.FORCE_ROOT === "1" ? 80 : 5000),
);
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
  try {
    await connectDB();

    const server =
      useLocalHttps && sslCredentials
        ? https.createServer(sslCredentials, app)
        : http.createServer(app);

    if (useLocalHttps && !sslCredentials) {
      console.warn(
        "USE_HTTPS is enabled but SSL key/cert are not configured. Starting HTTP server instead.",
      );
    }

    server.listen(PORT, HOST, () => {
      console.log(`Server running on ${HOST}:${PORT}`);
      console.log(
        `Protocol: ${useLocalHttps && sslCredentials ? "https" : "http"}`,
      );
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};
// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

startServer();
