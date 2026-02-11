// app.js
require("dotenv").config();
require("./services/subscribers/logger");

const express = require("express");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");
const path = require("path");

const routes = require("./routes/index");

const app = express();

/* ---------------------------------------------------
   ENV + CONFIG
--------------------------------------------------- */
const NODE_ENV = process.env.NODE_ENV || "development";
const MONGO_URI = process.env.DB;

if (!MONGO_URI) {
  console.error("❌ Missing DB connection string in process.env.DB");
  // On Vercel, don't process.exit; just fail requests later
}

/* ---------------------------------------------------
   MIDDLEWARE
--------------------------------------------------- */
app.use(express.json());

if (NODE_ENV === "development") {
  app.use(morgan("dev"));
}

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      NODE_ENV === "development" || corsOrigins.length === 0
        ? "*"
        : corsOrigins,
  })
);

// ⚠ On Vercel, local filesystem isn't durable. Keep this only if you truly need it.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", env: NODE_ENV, time: new Date().toISOString() });
});

/* ---------------------------------------------------
   DB CONNECTION (cache connection across invocations)
--------------------------------------------------- */
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  if (!MONGO_URI) throw new Error("Missing DB env var");

  await mongoose.connect(MONGO_URI);
  isConnected = true;
  console.log("✅ MongoDB connected");
}

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------
   ROUTES
--------------------------------------------------- */
app.use(routes);
app.disable("etag");

/* ---------------------------------------------------
   GLOBAL ERROR HANDLER
--------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
