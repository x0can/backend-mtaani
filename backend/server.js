// server.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const routes = require("./routes/index");
const { startPresenceMonitor } = require("./services/presenceService");
const { User, Order } = require("./db");

const { handleProductEvent } = require("./services/productEventsBus");
const EVENTS = require("./events/productEvents");

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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    env: NODE_ENV,
    time: new Date().toISOString(),
  });
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

// Make io available in routes via req.io AND req.app.get('io')
app.set("io", io);

app.use((req, res, next) => {
  req.io = io;

  // actorId: ideally from authMiddleware (req.user?.id)
  req.emitProductEvent = (event, payload) =>
    handleProductEvent(event, payload, io, req.user?._id);

  next();
});

/* ---------------------------------------------------
   DB CONNECTION
--------------------------------------------------- */
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    // pass io so presenceService can emit offline events
    startPresenceMonitor(io);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error", err);
    process.exit(1);
  });

/* ---------------------------------------------------
   SOCKET.IO EVENTS
--------------------------------------------------- */
io.on("connection", (socket) => {
  console.log("🔌 socket connected:", socket.id);

  /* ---------------------------
     🟢 CUSTOMER ONLINE
  -----------------------------*/
  socket.on("customer:online", async ({ userId }) => {
    if (!userId) return;

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
      lastHeartbeat: new Date(),
    });

    io.emit("customer:online", {
      customerId: userId,
      lastSeen: new Date(),
    });

    console.log("🟢 Customer ONLINE:", userId);
  });

  /* ---------------------------
     📍 CUSTOMER LIVE LOCATION
  -----------------------------*/
  socket.on("customer:location", async ({ userId, coords, orderId }) => {
    if (!userId || !coords) return;

    // Update user's real-time location
    await User.findByIdAndUpdate(userId, {
      currentLocation: coords,
      lastSeen: new Date(),
    });

    // ALSO update order location if provided
    if (orderId) {
      try {
        await Order.findByIdAndUpdate(orderId, {
          customerLocation: coords,
        });
        console.log("📦 Updated order customerLocation:", orderId, coords);
      } catch (err) {
        console.log("❌ Failed to update order customerLocation:", err);
      }
    }

    // Emit global event
    io.emit("customer:location", {
      userId,
      lat: coords.lat,
      lng: coords.lng,
    });

    console.log("📍 Customer location:", userId, coords);
  });

  socket.on("customer:locationOrder", async ({ orderId, userId, lat, lng }) => {
    if (!orderId || !userId) return;

    const coords = { lat, lng };

    // Update user
    await User.findByIdAndUpdate(userId, {
      currentLocation: coords,
      lastSeen: new Date(),
    });

    // Update the order
    try {
      await Order.findByIdAndUpdate(orderId, {
        customerLocation: coords,
      });
    } catch (err) {
      console.log("❌ Failed updating order:", err);
    }

    // Emit to rider inside that order room
    io.to(`order:${orderId}`).emit("order:customer-location", {
      orderId,
      userId,
      lat,
      lng,
    });

    console.log(`📍 CUSTOMER ORDER LOCATION ${orderId}:`, lat, lng);
  });

  /* ---------------------------
     ❤️ CUSTOMER HEARTBEAT
  -----------------------------*/
  socket.on("customer:heartbeat", async ({ userId }) => {
    if (!userId) return;

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastHeartbeat: new Date(),
    });

    io.emit("customer:heartbeat", {
      userId,
      lastSeen: new Date(),
    });
  });

  /* ---------------------------
       🟢 RIDER ONLINE
  --------------------------- */
  socket.on("rider:online", async ({ userId }) => {
    if (!userId) return;

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
      lastHeartbeat: new Date(),
    });

    console.log(`🟢 Rider ONLINE: ${userId}`);

    io.emit("rider:online", {
      riderId: userId,
      lastSeen: new Date(),
    });
  });

  /* ---------------------------
       ❤️ RIDER HEARTBEAT
  --------------------------- */
  socket.on("rider:heartbeat", async ({ userId }) => {
    if (!userId) return;

    await User.findByIdAndUpdate(userId, {
      lastHeartbeat: new Date(),
      isOnline: true,
    });

    io.emit("rider:heartbeat", {
      riderId: userId,
      lastSeen: new Date(),
    });
  });

  /* ---------------------------
       📍 RIDER LIVE LOCATION
  --------------------------- */
  socket.on("rider:updateLocation", async ({ userId, lat, lng }) => {
    if (!userId || typeof lat !== "number" || typeof lng !== "number") {
      console.log("⚠ Invalid location payload:", { userId, lat, lng });
      return;
    }

    console.log("📍 Rider location received:", userId, lat, lng);

    await User.findByIdAndUpdate(userId, {
      currentLocation: { lat, lng },
      lastSeen: new Date(),
    });

    io.emit("rider:location", {
      riderId: userId,
      lat,
      lng,
    });
  });

  /* ---------------------------
       ORDER ROOM JOIN
  --------------------------- */
  socket.on("order:join", (orderId) => {
    if (!orderId) return;
    console.log(`📦 Rider joined order room: ${orderId}`);
    socket.join(`order:${orderId}`);
  });

  /* ---------------------------
       ORDER-SPECIFIC LOCATION
  --------------------------- */
  socket.on("rider:locationOrder", ({ orderId, lat, lng }) => {
    if (!orderId || typeof lat !== "number" || typeof lng !== "number") return;

    io.to(`order:${orderId}`).emit("order:rider-location", {
      orderId,
      lat,
      lng,
    });
  });

  /* ---------------------------
       ❌ DISCONNECT
  --------------------------- */
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
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

/* ---------------------------------------------------
   START SERVER
--------------------------------------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
});

module.exports = { app, io, server };
