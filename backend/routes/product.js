// routes/productRoutes.js
const express = require("express");
const router = express.Router();

const { Product } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");
const {
  getCache,
  setCache,
  delCache,
  delCacheByNamespace,
} = require("../services/cache");

/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/
router.get("/api/products/home", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    // how many pages to batch in one request
    const batchPages = Math.min(Number(req.query.batchPages) || 1, 3000);

    const skip = (page - 1) * limit;
    const batchLimit = limit * batchPages;

    const query = {
      deleted: { $ne: true },
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
      $or: [{ stock: { $gt: 0 } }, { stock: { $exists: false } }],
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .select({
          title: 1,
          price: 1,
          images: 1,
          featured: 1,
          featuredOrder: 1,
          isFlashDeal: 1,
          category: 1,
          discount: 1,
          stock: 1,
          createdAt: 1,
        })
        .populate("category", "name slug")
        .sort({
          featured: -1,
          featuredOrder: 1,
          isFlashDeal: -1,
          createdAt: -1,
          _id: 1, // stable sort (IMPORTANT)
        })
        .skip(skip)
        .limit(batchLimit)
        .lean(),

      Product.countDocuments(query),
    ]);

    const nextPage = page + batchPages;
    const hasMore = skip + products.length < total;

    res.json({
      data: products,
      meta: {
        page,
        limit,
        batchPages,
        nextPage,
        total,
        hasMore,
      },
    });
  } catch (err) {
    console.error("❌ Home products error:", err);
    res.status(500).json({ message: "Failed to load home products" });
  }
});

/***********************************************************************
 *  FLASH DEAL UPDATE (ADMIN)
 ***********************************************************************/
router.put(
  "/api/products/:id/flash-deal",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { enabled, discountPercent, startAt, endAt } = req.body;

      if (enabled) {
        if (!discountPercent || discountPercent <= 0 || discountPercent > 90) {
          return res.status(400).json({ message: "Invalid discount percent" });
        }

        if (!startAt || !endAt) {
          return res
            .status(400)
            .json({ message: "Flash deal start and end required" });
        }

        if (new Date(startAt) >= new Date(endAt)) {
          return res
            .status(400)
            .json({ message: "End date must be after start date" });
        }
      }

      const update = enabled
        ? {
            isFlashDeal: true,
            flashDeal: {
              discountPercent,
              startAt: new Date(startAt),
              endAt: new Date(endAt),
            },
          }
        : {
            isFlashDeal: false,
            flashDeal: null,
          };

      const product = await Product.findByIdAndUpdate(req.params.id, update, {
        new: true,
      }).populate("category");

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // 🔥 Clear caches
      await delCache("products:home");
      await delCache("products:list:all");

      // Optional real-time update
      req.io?.emit("product:flash-deal-updated", product);

      res.json(product);
    } catch (err) {
      console.error("Flash deal update error:", err);
      res.status(500).json({ message: "Failed to update flash deal" });
    }
  }
);

/***********************************************************************
 *  FLASH DEAL PRODUCTS (PUBLIC)
 ***********************************************************************/
router.get("/api/products/flash-deals", async (req, res) => {
  try {
    const now = new Date();

    const products = await Product.find({
      isFlashDeal: true,
      isActive: true,
      stock: { $gt: 0 },
      "flashDeal.startAt": { $lte: now },
      "flashDeal.endAt": { $gte: now },
    })
      .populate("category", "name")
      .sort({ "flashDeal.endAt": 1 })
      .lean();

    res.json(products);
  } catch (err) {
    console.error("Flash deals fetch error:", err);
    res.status(500).json({ message: "Failed to load flash deals" });
  }
});

router.get("/api/products", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 24, 50);
    const skip = (page - 1) * limit;

    const {
      search,
      category,
      featured,
      flash,
      inStock,
      active = "true",
    } = req.query;

    const query = {};

    if (active === "true") query.isActive = true;
    if (inStock === "true") query.stock = { $gt: 0 };
    if (featured === "true") query.featured = true;
    if (flash === "true") query.isFlashDeal = true;
    if (category) query.category = category;

    if (search) {
      query.$or = [{ title: { $regex: search, $options: "i" } }];
    }

    const cacheKey = `products:list:v3:${JSON.stringify({
      page,
      limit,
      search,
      category,
      featured,
      flash,
      inStock,
      active,
      sort: req.query.sort,
    })}`;

    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const [products, total] = await Promise.all([
      Product.find(query)
        .select({
          title: 1,
          price: 1,
          stock: 1,
          images: 1,
          featured: 1,
          featuredOrder: 1,
          isFlashDeal: 1,
          flashDeal: 1,
          category: 1,
          createdAt: 1,
        })
        .populate("category", "name")
        .sort({
          featured: -1,
          featuredOrder: 1,
          isFlashDeal: -1,
          stock: -1,
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Product.countDocuments(query),
    ]);

    const response = {
      data: products,
      meta: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + products.length < total,
      },
    };

    await setCache(cacheKey, response, 600, "products:list");
    res.json(response);
  } catch (err) {
    console.error("Products list error:", err);
    res.status(500).json({ message: "Failed to load products" });
  }
});

router.post("/api/products", authMiddleware, adminOnly, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    const populated = await Product.findById(product._id).populate("category");
    await Promise.all([
      delCacheByNamespace("products:home"),
      delCacheByNamespace("products:list"),
    ]);

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
  await Promise.all([
    delCacheByNamespace("products:home"),
    delCacheByNamespace("products:list"),
  ]);

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
