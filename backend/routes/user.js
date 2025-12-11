// routes/userRoutes.js
const express = require("express");
const router = express.Router();

const { User, Order } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");

/***********************************************************************
 *  ADMIN — USER MANAGEMENT
 ***********************************************************************/
router.get("/api/admin/users", authMiddleware, adminOnly, async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

router.put("/api/user/profile-image", authMiddleware, async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ message: "Image URL is required" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { image },
      { new: true }
    );

    res.json(updatedUser);
  } catch (err) {
    console.error("Profile image update error:", err);
    res.status(500).json({ message: "Failed to update profile image" });
  }
});

// VERIFY USER
router.patch(
  "/api/admin/users/:id/verify",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.verified = true;
    await user.save();
    res.json({ success: true, user });
  }
);

// UNVERIFY USER
router.patch(
  "/api/admin/users/:id/unverify",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.verified = false;
    await user.save();
    res.json({ success: true, user });
  }
);

// PROMOTE TO RIDER
router.patch(
  "/api/admin/users/:id/promote-rider",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = "rider";
    await user.save();
    res.json({ success: true, user });
  }
);

// MAKE CUSTOMER
router.patch(
  "/api/admin/users/:id/make-customer",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = "customer";
    await user.save();
    res.json({ success: true, user });
  }
);

// ACTIVATE/SUSPEND USER
router.patch(
  "/api/admin/users/:id/status",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.active = !user.active;
    await user.save();
    res.json({ success: true, user });
  }
);

// DELETE USER
router.delete(
  "/api/admin/users/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ success: true, message: "User deleted" });
  }
);

// UPDATE USER
router.put(
  "/api/admin/users/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const allowed = ["name", "email", "phone", "role", "verified", "active"];
      const updates = {};

      allowed.forEach((key) => {
        if (typeof req.body[key] !== "undefined") updates[key] = req.body[key];
      });

      const user = await User.findByIdAndUpdate(req.params.id, updates, {
        new: true,
      }).select("-passwordHash");

      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ success: true, user });
    } catch (err) {
      console.error("Update user failed:", err);
      res.status(500).json({ message: "Update failed" });
    }
  }
);

/***********************************************************************
 *  RIDER TRACKING — SELF STATUS ENDPOINTS
 ***********************************************************************/
router.get("/api/user/status", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "isOnline lastSeen lastHeartbeat currentLocation role"
    );

    if (!user || user.role !== "rider") {
      return res.status(403).json({ message: "Not a rider" });
    }

    res.json({
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      lastHeartbeat: user.lastHeartbeat,
      currentLocation: user.currentLocation,
    });
  } catch (err) {
    console.error("Status fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/***********************************************************************
 *  ADMIN — CUSTOMERS + THEIR ORDERS
 ***********************************************************************/
router.get(
  "/api/admin/customers/with-orders",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const customers = await User.find({ role: "customer" })
        .select(
          "name email phone isOnline lastSeen lastHeartbeat currentLocation"
        )
        .lean();

      const orders = await Order.find()
        .populate("user", "name phone email")
        .sort("-createdAt")
        .lean();

      res.json({ customers, orders });
    } catch (err) {
      console.error("Failed to load customers:", err);
      res.status(500).json({ message: "Failed to load customers" });
    }
  }
);

// GET orders for a specific customer
router.get(
  "/api/admin/customer/:id/orders",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const orders = await Order.find({ user: req.params.id })
        .populate("items.product", "title images price category")
        .populate("user", "name phone email");

      res.json({ success: true, orders });
    } catch (err) {
      console.error("Customer orders error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
