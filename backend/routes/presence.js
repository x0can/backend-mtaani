const express = require("express");
const router = express.Router();

const { User } = require("../db");
const { authMiddleware, adminOnly, allowRoles } = require("../auth");

/***********************************************************************
 *  USER ONLINE / OFFLINE / HEARTBEAT
 ***********************************************************************/
router.post(
  "/api/user/online",
  authMiddleware,
  allowRoles("rider", "customer", "admin"),
  async (req, res) => {
    try {
      req.user.isOnline = true;
      req.user.lastHeartbeat = new Date();
      req.user.lastSeen = new Date();
      await req.user.save();

      // Emit for riders so admins can see live presence
      const io = req.app.get("io");
      if (io && req.user.role === "rider") {
        io.emit("rider:online", {
          riderId: req.user._id,
          lastSeen: req.user.lastSeen,
        });
      }

      res.json({ success: true, message: `${req.user.role} online` });
    } catch (err) {
      console.error("Presence online error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/api/user/heartbeat", authMiddleware, async (req, res) => {
  try {
    req.user.lastHeartbeat = new Date();
    req.user.isOnline = true;
    await req.user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Heartbeat error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/api/user/offline",
  authMiddleware,
  allowRoles("rider", "customer", "admin"),
  async (req, res) => {
    try {
      req.user.isOnline = false;
      req.user.lastSeen = new Date();
      await req.user.save();

      const io = req.app.get("io");
      if (io && req.user.role === "rider") {
        io.emit("rider:offline", {
          riderId: req.user._id,
          lastSeen: req.user.lastSeen,
        });
      }

      res.json({ success: true, message: "User offline" });
    } catch (err) {
      console.error("Presence offline error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/***********************************************************************
 *  ADMIN — SET RIDER ONLINE/OFFLINE
 ***********************************************************************/
router.patch(
  "/api/admin/rider/:id/online",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const rider = await User.findById(req.params.id);

    if (!rider || rider.role !== "rider")
      return res.status(404).json({ message: "Rider not found" });

    rider.isOnline = true;
    rider.lastSeen = new Date();
    await rider.save();

    const io = req.app.get("io");
    io?.emit("rider:online", { riderId: rider._id, lastSeen: rider.lastSeen });

    res.json({ success: true, rider });
  }
);

router.patch(
  "/api/admin/rider/:id/offline",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const rider = await User.findById(req.params.id);

    if (!rider || rider.role !== "rider")
      return res.status(404).json({ message: "Rider not found" });

    rider.isOnline = false;
    rider.lastSeen = new Date();
    await rider.save();

    const io = req.app.get("io");
    io?.emit("rider:offline", { riderId: rider._id, lastSeen: rider.lastSeen });

    res.json({ success: true, rider });
  }
);

module.exports = router;
