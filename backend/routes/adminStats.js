// routes/adminStatsRoutes.js
const express = require("express");
const router = express.Router();

const { User, Product, Order } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");

/***********************************************************************
 *  ADMIN — ANALYTICS & REPORTING
 ***********************************************************************/
router.get(
  "/api/admin/stats/overview",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const totalUsers = await User.countDocuments();
      const totalProducts = await Product.countDocuments();
      const totalOrders = await Order.countDocuments();

      const revenueAgg = await Order.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, revenue: { $sum: "$total" } } },
      ]);

      const revenue = revenueAgg[0]?.revenue || 0;

      const riders = await User.countDocuments({
        role: "rider",
        verified: true,
      });

      res.json({
        totalUsers,
        totalProducts,
        totalOrders,
        revenue,
        riders,
      });
    } catch (err) {
      console.error("Stats overview failed:", err);
      res.status(500).json({ message: "Failed to load stats" });
    }
  }
);

/***********************************************************************
 *  ADMIN — SET FEATURED PRODUCTS (TOP 20)
 ***********************************************************************/



module.exports = router;
