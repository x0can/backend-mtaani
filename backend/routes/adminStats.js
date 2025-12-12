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
router.put(
  "/api/admin/products/featured",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { products } = req.body;
      // products = [{ id, order }]

      if (!Array.isArray(products) || products.length > 20) {
        return res
          .status(400)
          .json({ message: "Maximum of 20 featured products allowed" });
      }

      // 1️⃣ Reset all featured flags
      await Product.updateMany(
        { featured: true },
        { featured: false, featuredOrder: null }
      );

      // 2️⃣ Apply new featured set
      for (const item of products) {
        await Product.findByIdAndUpdate(item.id, {
          featured: true,
          featuredOrder: item.order,
        });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Set featured products error:", err);
      res.status(500).json({ message: "Failed to update featured products" });
    }
  }
);


module.exports = router;
