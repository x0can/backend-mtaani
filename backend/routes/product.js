// routes/productRoutes.js
const express = require("express");
const router = express.Router();

const { Product } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");

/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/
router.get("/api/products/home", async (req, res) => {
  try {
    // 1️⃣ Admin curated products
    const featured = await Product.find({ featured: true })
      .populate("category")
      .sort({ featuredOrder: 1 })
      .limit(20);

    const featuredIds = featured.map((p) => p._id);

    // 2️⃣ Fill remaining slots with latest products
    const remaining = 20 - featured.length;
    let latest = [];

    if (remaining > 0) {
      latest = await Product.find({
        _id: { $nin: featuredIds },
      })
        .populate("category")
        .sort({
          priceUpdatedAt: -1,
          createdAt: -1,
        })
        .limit(remaining);
    }

    res.json([...featured, ...latest]);
  } catch (err) {
    console.error("Home products error:", err);
    res.status(500).json({ message: "Failed to load home products" });
  }
});



router.get("/api/products", async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      const regex = new RegExp(search, "i");
      query = {
        $or: [{ title: { $regex: regex } }, { description: { $regex: regex } }],
      };
    }

    const products = await Product.find(query).populate("category");
    res.json(products);
  } catch (err) {
    console.error("Fetch products failed:", err);
    res.status(500).json({ message: "Failed to load products" });
  }
});

router.post("/api/products", authMiddleware, adminOnly, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    console.error("Create product failed:", err);
    res.status(400).json({ message: "Invalid product data" });
  }
});

router.put(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    if (req.body.price !== undefined) {
      req.body.priceUpdatedAt = new Date();
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json(product);
  }
);

router.delete(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Deleted" });
  }
);

router.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/***********************************************************************
 *  HOME PRODUCTS (TOP 20)
 ***********************************************************************/



module.exports = router;
