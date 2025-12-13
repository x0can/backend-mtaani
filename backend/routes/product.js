// routes/productRoutes.js
const express = require("express");
const router = express.Router();

const { Product } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");
const { getCache, setCache, delCache } = require("../services/cache");


/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/
router.get("/api/products/home", async (req, res) => {
  const cacheKey = "products:home";

  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  const featured = await Product.find({ featured: true })
    .populate("category")
    .sort({ featuredOrder: 1 })
    .limit(20);

  const featuredIds = featured.map(p => p._id);

  const remaining = 20 - featured.length;
  let latest = [];

  if (remaining > 0) {
    latest = await Product.find({ _id: { $nin: featuredIds } })
      .populate("category")
      .sort({ priceUpdatedAt: -1, createdAt: -1 })
      .limit(remaining);
  }

  const result = [...featured, ...latest];
  await setCache(cacheKey, result, 600); // 10 min

  res.json(result);
});




router.get("/api/products", async (req, res) => {
  const { search } = req.query;
  const cacheKey = `products:list:${search || "all"}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  let query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query = { $or: [{ title: regex }, { description: regex }] };
  }

  const products = await Product.find(query).populate("category");
  await setCache(cacheKey, products, 600);

  res.json(products);
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
