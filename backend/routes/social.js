const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { Product, ProductInteraction, User } = require("../db");
const { authMiddleware } = require("../auth");
const { delCache } = require("../services/cache");

// Toggle like
router.post("/api/interactions/like", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: "productId required" });

    const existing = await ProductInteraction.findOne({ user: userId, product: productId, type: "like" });
    let liked;
    if (existing) {
      await existing.deleteOne();
      await Product.findByIdAndUpdate(productId, { $inc: { likeCount: -1 } });
      liked = false;
    } else {
      await ProductInteraction.create({ user: userId, product: productId, type: "like", weight: 3 });
      await Product.findByIdAndUpdate(productId, { $inc: { likeCount: 1 } });
      liked = true;
    }
    const product = await Product.findById(productId).select("likeCount");
    await delCache(`products:home:v5:user:${userId}`);
    res.json({ liked, likeCount: product?.likeCount ?? 0 });
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ message: "Failed to toggle like" });
  }
});

// Get liked product IDs for current user
router.get("/api/me/liked-products", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const likes = await ProductInteraction.find({ user: userId, type: "like" }).select("product");
    res.json(likes.map(l => String(l.product)));
  } catch {
    res.json([]);
  }
});

// Save category preferences
router.put("/api/me/preferences", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { categoryIds } = req.body;
    if (!Array.isArray(categoryIds)) return res.status(400).json({ message: "categoryIds must be an array" });
    await User.findByIdAndUpdate(userId, { categoryPreferences: categoryIds });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: "Failed to save preferences" });
  }
});

// For You personalized feed
router.get("/api/products/for-you", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("categoryPreferences").lean();
    const LIMIT = 20;
    const projection = { title: 1, price: 1, images: 1, category: 1, likeCount: 1, isFlashDeal: 1, featured: 1, stock: 1, createdAt: 1 };

    const prefCatIds = (user?.categoryPreferences || []).map(String);
    const recentLikes = await ProductInteraction.find({ user: userId, type: "like" })
      .sort({ createdAt: -1 }).limit(20)
      .populate({ path: "product", select: "category" });
    const likedCatIds = [...new Set(recentLikes.map(l => String(l.product?.category)).filter(Boolean))];
    const allCatIds = [...new Set([...prefCatIds, ...likedCatIds])];

    let products;
    if (allCatIds.length > 0) {
      products = await Product.find({ category: { $in: allCatIds }, isActive: true, stock: { $gt: 0 } })
        .select(projection).populate("category", "name slug")
        .sort({ likeCount: -1, createdAt: -1 }).limit(LIMIT).lean();
    } else {
      products = await Product.find({ featured: true, isActive: true, stock: { $gt: 0 } })
        .select(projection).populate("category", "name slug")
        .sort({ likeCount: -1, createdAt: -1 }).limit(LIMIT).lean();
    }
    res.json(products);
  } catch (err) {
    console.error("For You error:", err);
    res.status(500).json([]);
  }
});

module.exports = router;
