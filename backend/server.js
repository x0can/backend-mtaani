// server.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const routes = require("./routes");

const app = express();

/* ---------------------------------------------------
   ENV + CONFIG
--------------------------------------------------- */
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.DB;

if (!MONGO_URI) {
  console.error("❌ Missing DB connection string in process.env.DB");
  process.exit(1);
}

/* ---------------------------------------------------
   MIDDLEWARE
--------------------------------------------------- */

// Parse JSON bodies
app.use(express.json());

// Logging (only in dev)
if (NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// CORS – allow all in dev, lock down in prod
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      NODE_ENV === "development" || corsOrigins.length === 0
        ? "*" // dev / fallback
        : corsOrigins,
  })
);

// Static serving for uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Simple health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    env: NODE_ENV,
    time: new Date().toISOString(),
  });
});

/* ---------------------------------------------------
   DB CONNECTION
--------------------------------------------------- */
mongoose
  .connect(MONGO_URI, {
    // modern mongoose (these options are optional on latest versions)
  
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error", err);
    process.exit(1);
  });

/* ---------------------------------------------------
   HTTP SERVER + SOCKET.IO
--------------------------------------------------- */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin:
      NODE_ENV === "development" || corsOrigins.length === 0
        ? "*"
        : corsOrigins,
  },
});

// Attach io to every request BEFORE routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

/* ---------------------------------------------------
   SOCKET.IO EVENTS
--------------------------------------------------- */
io.on("connection", (socket) => {
  console.log("🔌 socket connected:", socket.id);

  // Client joins a room for a specific order
  socket.on("order:join", (orderId) => {
    if (!orderId) return;
    socket.join(`order:${orderId}`);
  });

  // Rider sends location updates
  socket.on("rider:location", (data = {}) => {
    const { orderId, lat, lng } = data;
    if (!orderId || typeof lat !== "number" || typeof lng !== "number") return;

    // Broadcast to clients watching this order
    io.to(`order:${orderId}`).emit("order:location", { orderId, lat, lng });
  });

  socket.on("disconnect", () => {
    console.log("❌ socket disconnected:", socket.id);
  });
});

/* ---------------------------------------------------
   ROUTES
--------------------------------------------------- */
app.use(routes);

/* ---------------------------------------------------
   GLOBAL ERROR HANDLER (KEEP LAST)
--------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

/* ---------------------------------------------------
   START SERVER
--------------------------------------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
});

module.exports = { app, io, server };
