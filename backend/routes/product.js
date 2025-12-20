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
  try {
    const LIMIT = 3000;
    const cacheKey = "products:home:v2";

    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    // 🔹 Common projection (adjust fields as needed)
    const projection = {
      title: 1,
      price: 1,
      images: 1,
      featured: 1,
      featuredOrder: 1,
      priceUpdatedAt: 1,
      createdAt: 1,
      category: 1,
    };

    // 🔹 Fetch featured first
    const featuredPromise = Product.find({ featured: true })
      .select(projection)
      .populate("category", "name slug")
      .sort({ featuredOrder: 1 })
      .limit(2000)
      .lean();

    const featured = await featuredPromise;
    const featuredIds = featured.map((p) => p._id);

    const remaining = LIMIT - featured.length;

    let latest = [];
    if (remaining > 0) {
      latest = await Product.find({ _id: { $nin: featuredIds } })
        .select(projection)
        .populate("category", "name slug")
        .sort({ priceUpdatedAt: -1, createdAt: -1 })
        .limit(remaining)
        .lean();
    }

    const result = [...featured, ...latest];

    await setCache(cacheKey, result, 600); // 10 min cache
    res.json(result);
  } catch (err) {
    console.error("Home products error:", err);
    res.status(500).json({ message: "Failed to load home products" });
  }
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
    const populated = await Product.findById(product._id).populate("category");
    await delCache("products:list:all");
    await delCache("products:home");

    req.io.emit("product:created", populated);
    res.status(201).json(populated);
  } catch (err) {
    console.error("Create product failed:", err);
    res.status(400).json({ message: "Invalid product data" });
  }
});

router.put("/api/products/:id", authMiddleware, adminOnly, async (req, res) => {
  if (req.body.price !== undefined) {
    req.body.priceUpdatedAt = new Date();
  }

  const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });

  if (!product) return res.status(404).json({ message: "Product not found" });
  await delCache("products:list:all");
  await delCache("products:home");
  res.json(product);
});

router.delete(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Deleted" });
  }
);



// GET /api/products/paginated?page=1&limit=20
/***********************************************************************
 *  PAGINATED PRODUCTS (MUST BE ABOVE :id)
 ***********************************************************************/
router.get("/api/products/paginated", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const search = req.query.search?.trim();
    const category = req.query.category;

    const query = {};

    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    if (category) {
      query.category = category;
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("category", "name")
        .sort({ createdAt: -1 }) // stable pagination
        .skip(skip)
        .limit(limit)
        .lean(),

      Product.countDocuments(query),
    ]);

    res.json({
      products,
      hasMore: skip + products.length < total,
      page,
    });
  } catch (err) {
    console.error("Paginated products error:", err);
    res.status(500).json({ message: "Failed to load products" });
  }
});

/***********************************************************************
 *  SINGLE PRODUCT (KEEP LAST)
 ***********************************************************************/
router.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ message: "Server error" });
  }
});


/***********************************************************************
 *  HOME PRODUCTS (TOP 20)
 ***********************************************************************/

module.exports = router;
