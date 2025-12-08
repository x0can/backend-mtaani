// routes/riderRoutes.js
const express = require("express");
const router = express.Router();

const { User, Order } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");




// GET /api/admin/riders/live
router.get("/riders/live", adminOnly, async (req, res) => {
  try {
    const riders = await User.find({ role: "rider" })
      .select("name phone isOnline lastSeen lastHeartbeat currentLocation assignedOrders");

    res.json({ success: true, riders });
  } catch (err) {
    console.error("Live riders error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



/***********************************************************************
 *  RIDER: ROUTE PLAN (OPTIONAL)
 ***********************************************************************/
router.post("/api/rider/destination", authMiddleware, async (req, res) => {
  try {
    const { start, end } = req.body;

    if (!start || !end)
      return res.status(400).json({ message: "Start and end are required" });

    req.user.routePlan = { start, end };
    await req.user.save();

    res.json({ success: true, routePlan: req.user.routePlan });
  } catch (err) {
    console.log("Route save error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/***********************************************************************
 *  RIDER: LIVE LOCATION / ORDERS / DELIVERY
 ***********************************************************************/
router.post("/api/rider/location", authMiddleware, async (req, res) => {
  try {
    const { lat, lng, orderId } = req.body;

    if (req.user.role !== "rider" && !req.user.isAdmin)
      return res
        .status(403)
        .json({ message: "Forbidden — riders or admins only" });

    if (typeof lat !== "number" || typeof lng !== "number")
      return res.status(400).json({ message: "Coordinates invalid" });

    const rider = await User.findById(req.user._id);
    rider.currentLocation = { lat, lng };
    rider.lastSeen = new Date();
    await rider.save();

    const io = req.io || req.app.get("io");

    if (io) {
      io.emit("rider:location", {
        riderId: rider._id,
        name: rider.name,
        lat,
        lng,
      });

      if (orderId) {
        io.to(`order:${orderId}`).emit("order:rider-location", {
          orderId,
          lat,
          lng,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Location update failed:", err);
    res.status(500).json({ message: "Location update failed" });
  }
});


/**
 * Admin: riders + their orders
 */
router.get(
  "/api/admin/riders/with-orders",
  authMiddleware,
  async (req, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const riders = await User.find({ role: "rider" })
        .select("name email phone isOnline")
        .lean();

      const orders = await Order.find({ rider: { $ne: null } })
        .populate("rider", "name phone email")
        .populate("user", "name phone email")
        .sort("-createdAt");

      res.json({ riders, orders });
    } catch (err) {
      console.error("Failed to load rider orders:", err);
      res.status(500).json({ message: "Failed to load rider orders" });
    }
  }
);

/**
 * Get rider orders
 * - Rider sees their own orders
 * - Admin can pass ?riderId=xxxx
 */
router.get("/api/riders/orders", authMiddleware, async (req, res) => {
  try {
    const riderId = req.user.isAdmin
      ? req.query.riderId || req.user._id
      : req.user._id;

    const orders = await Order.find({ rider: riderId })
      .populate("user", "name email phone")
      .populate("rider", "name email phone")
      .populate({
        path: "items.product",
        populate: { path: "category" },
      })
      .sort("-createdAt");

    res.json(orders);
  } catch (err) {
    console.error("Failed to fetch rider orders:", err);
    res.status(500).json({ message: "Failed to fetch rider orders" });
  }
});

// RIDER ACCEPTS ORDER (Admin allowed to simulate)
router.post(
  "/api/rider/orders/:orderId/accept",
  authMiddleware,
  async (req, res) => {
    const { orderId } = req.params;

    try {
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (String(order.rider) !== String(req.user._id) && !req.user.isAdmin) {
        return res.status(403).json({ message: "Not assigned to you" });
      }

      order.status = "shipped";
      await order.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({ success: true, order: populated });
    } catch (err) {
      console.error("Failed to accept order:", err);
      res.status(500).json({ message: "Failed to accept order" });
    }
  }
);

// RIDER MARKS ORDER DELIVERED
router.post(
  "/api/rider/orders/:orderId/deliver",
  authMiddleware,
  async (req, res) => {
    const { orderId } = req.params;

    try {
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (String(order.rider) !== String(req.user._id) && !req.user.isAdmin) {
        return res.status(403).json({ message: "Not assigned to you" });
      }

      order.status = "completed";
      await order.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({ success: true, order: populated });
    } catch (err) {
      console.error("Failed to deliver order:", err);
      res.status(500).json({ message: "Failed to deliver order" });
    }
  }
);

module.exports = router;
