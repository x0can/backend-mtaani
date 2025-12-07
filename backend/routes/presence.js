// routes/presenceRoutes.js
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
    req.user.isOnline = true;
    req.user.lastHeartbeat = new Date();
    req.user.lastSeen = new Date();
    await req.user.save();

    res.json({ success: true, message: `${req.user.role} online` });
  }
);

router.post("/api/user/heartbeat", authMiddleware, async (req, res) => {
  req.user.lastHeartbeat = new Date();
  req.user.isOnline = true;
  await req.user.save();

  res.json({ success: true });
});

router.post(
  "/api/user/offline",
  authMiddleware,
  allowRoles("rider", "customer", "admin"),
  async (req, res) => {
    req.user.isOnline = false;
    req.user.lastSeen = new Date();
    await req.user.save();

    res.json({ success: true, message: "User offline" });
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
    await rider.save();

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
    await rider.save();

    res.json({ success: true, rider });
  }
);

module.exports = router;
