// routes/productRoutes.js
const express = require("express");
const router = express.Router();

const { Product, ProductInteraction } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");
const { getRecommendedForUser } = require("../services/recommendations");

const {
  getCache,
  setCache,
  delCache,
  delCacheByNamespace,
} = require("../services/cache");

const EVENTS = require("../events/productEvents");

const updateFlashDeal = require("../handlers/flashDeal");

/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/

router.get("/api/products/home", authMiddleware, async (req, res) => {
  try {
    // ✅ Guest + per-user cache
    const userId = req.user?._id || req.user?.id || null;

    const cacheKey = userId
      ? `products:home:v5:user:${userId}`
      : "products:home:v5";

    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const projection = {
      title: 1,
      price: 1,
      images: 1,
      featured: 1,
      featuredOrder: 1,
      isFlashDeal: 1,
      category: 1,
      priceUpdatedAt: 1,
      discount: 1,
      stock: 1,
      createdAt: 1,
    };

    const HERO_LIMIT = 12;
    const FLASH_LIMIT = 12;
    const QUICK_LIMIT = 12; // also recommended size
    const FEATURED_LIMIT = 250;
    const NEW_LIMIT = 250;

    const [featured, flashDeals, quickPicks, newArrivals] = await Promise.all([
      Product.find({ featured: true })
        .select(projection)
        .populate("category", "name slug")
        .sort({ featuredOrder: 1, createdAt: -1 })
        .limit(FEATURED_LIMIT)
        .lean(),

      Product.find({ isFlashDeal: true })
        .select(projection)
        .populate("category", "name slug")
        .sort({ priceUpdatedAt: -1, createdAt: -1 })
        .limit(FLASH_LIMIT)
        .lean(),

      // 🔥 Global quick picks = most viewed
      ProductInteraction.aggregate([
        { $match: { type: "view" } },
        {
          $group: {
            _id: "$product",
            score: { $sum: "$weight" },
          },
        },
        { $sort: { score: -1 } },
        { $limit: QUICK_LIMIT },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        { $replaceRoot: { newRoot: "$product" } },
      ]),

      Product.find({})
        .select(projection)
        .populate("category", "name slug")
        .sort({ createdAt: -1 })
        .limit(NEW_LIMIT)
        .lean(),
    ]);

    // ✅ Recommended (personalized with time decay)
    let recommended = [];
    if (userId) {
      recommended = await getRecommendedForUser(String(userId), QUICK_LIMIT);
    }

    // ✅ Guest/empty fallback logic
    const hasHistory = await ProductInteraction.exists({ user: userId });

    if (!recommended.length && !hasHistory) {
      recommended = quickPicks.slice(0, QUICK_LIMIT);
    }

    const hero =
      featured.length > 0
        ? featured.slice(0, HERO_LIMIT)
        : newArrivals.slice(0, HERO_LIMIT);

    const payload = {
      hero,
      flashDeals,
      quickPicks,
      recommended,
      featured,
      newArrivals,
      meta: {
        version: "v5",
        generatedAt: new Date().toISOString(),
        personalized: Boolean(userId),
      },
    };

    // ✅ Redis optimization: shorter TTL for personalized
    await setCache(cacheKey, payload, userId ? 180 : 300, "products:home");

    res.json(payload);
  } catch (err) {
    console.error("Home products error:", err);
    res.status(500).json({ message: "Failed to load home products" });
  }
});

// TODO: set higher limit due to 1000's of results
router.get("/api/products/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "6", 10), 20);
    const category = req.query.category || null;

    if (q.length < 2 && !category) return res.json([]);

    const cacheKey = `products:search:v1:${q.toLowerCase()}:${
      category || "all"
    }:${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    // keep it small (for suggestions)
    const projection = {
      title: 1,
      price: 1,
      images: 1,
      discount: 1,
      stock: 1,
      category: 1,
      featured: 1,
      isFlashDeal: 1,
    };

    const baseFilter = {};
    if (category) baseFilter.category = category;

    // Prefer text search if you have an index. Otherwise fallback to regex.
    let items = [];

    // Attempt text search first (only works if you create a text index)
    // If you don't want to add index now, you can remove this block.
    try {
      items = await Product.find(
        { ...baseFilter, $text: { $search: q } },
        { score: { $meta: "textScore" } }
      )
        .select(projection)
        .populate("category", "name slug")
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();
    } catch {
      // fallback below
    }

    if (!items.length) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex
      items = await Product.find({
        ...baseFilter,
        title: { $regex: safe, $options: "i" },
      })
        .select(projection)
        .populate("category", "name slug")
        .sort({ featured: -1, updatedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean();
    }

    await setCache(cacheKey, items, 30); // 30s cache is enough
    res.json(items);
  } catch (err) {
    console.error("Search products error:", err);
    res.status(500).json({ message: "Search failed" });
  }
});
/***********************************************************************
 *  ALL PRODUCTS (NO PAGINATION)
 *  GET /api/products/all
 *  RETURNS { data: [] }
 ***********************************************************************/
router.get("/api/products/all", async (req, res) => {
  try {
    const products = await Product.find({
      deleted: { $ne: true },
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    })
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
        _id: 1,
      })
      .lean();

    res.json({ data: products });
  } catch (err) {
    console.error("❌ Fetch all products error:", err);
    res.status(500).json({ data: [] });
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
      const product = await updateFlashDeal({
        productId: req.params.id,
        payload: req.body,
        emit: req.emitProductEvent,
      });

      await req.emitProductEvent(EVENTS.PRODUCT_FLASH_UPDATED, {
        updatedAt: new Date(),
      });

      res.json(product);
    } catch (err) {
      res.status(400).json({ message: err.message });
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

router.put(
  "/api/admin/products/featured",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { products } = req.body;
      // products = [{ id, order }]

      if (!Array.isArray(products) || products.length > 2000) {
        return res
          .status(400)
          .json({ message: "Maximum of 2000 featured products allowed" });
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

      await req.emitProductEvent(EVENTS.PRODUCT_FEATURED_UPDATED, {
        updatedAt: new Date(),
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Set featured products error:", err);
      res.status(500).json({ message: "Failed to update featured products" });
    }
  }
);

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

    await req.emitProductEvent(EVENTS.PRODUCT_CREATED, {
      productId: populated._id,
      category: populated.category?._id,
    });

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
  await req.emitProductEvent(EVENTS.PRODUCT_UPDATED, {
    productId: product._id,
  });

  res.json(product);
});

router.delete(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    await req.emitProductEvent(EVENTS.PRODUCT_DELETED, {
      productId: product._id,
    });

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
router.get("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const userId = req.user?._id || req.user?.id; // ✅ DEFINE IT

    if (userId) {
      ProductInteraction.create({
        user: userId,
        product: product._id,
        type: "view",
        weight: 1,
      }).catch(() => {});

      await delCache(`products:home:v5:user:${userId}`);

      console.log(EVENTS.USER_INTERACTION);

      // 🔥 Emit socket event
      await req.emitProductEvent(EVENTS.USER_INTERACTION, {
        userId: String(userId),
        type: "view",
        productId: product._id,
      });
    }

    res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/api/interactions/search-click",
  authMiddleware,
  async (req, res) => {
    const { productId } = req.body;

    await ProductInteraction.create({
      user: req.user.id,
      product: productId,
      type: "search_click",
      weight: 2,
    });

    await delCache(`products:home:v5:user:${userId}`);

    // 🔥 Emit socket event
    await req.emitProductEvent(EVENTS.USER_INTERACTION, {
      userId,
      type: "view",
      productId: product._id,
    });

    res.json({ ok: true });
  }
);

router.get("/api/discovery/quick-picks", async (req, res) => {
  const cacheKey = "discovery:quick-picks:v1";
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  const data = await ProductInteraction.aggregate([
    { $match: { type: "view" } },
    {
      $group: {
        _id: "$product",
        score: { $sum: "$weight" },
      },
    },
    { $sort: { score: -1 } },
    { $limit: 50 },
    {
      $lookup: {
        from: "products",
        let: { productId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$productId"] },
              isActive: true,
              stock: { $gt: 0 },
            },
          },
        ],
        as: "product",
      },
    },
    { $unwind: "$product" },
    { $replaceRoot: { newRoot: "$product" } },
  ]);

  await setCache(cacheKey, data, 300, "discovery");
  res.json(data);
});


// CLEAR ALL IMAGES
// PUT /api/admin/products/:id/clear-images
router.put(
  "/api/admin/products/:id/clear-images",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      const product = await Product.findByIdAndUpdate(
        id,
        { $set: { images: [] } },
        { new: true }
      );

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Optional but recommended: clear caches
      await Promise.all([
        delCacheByNamespace?.("products:home").catch(() => {}),
        delCacheByNamespace?.("products:list").catch(() => {}),
        delCacheByNamespace?.("discovery").catch(() => {}),
      ]);

      // Emit socket/event update
      await req.emitProductEvent(EVENTS.PRODUCT_UPDATED, {
        productId: product._id,
        updatedAt: new Date(),
      });

      res.json({
        success: true,
        productId: product._id,
        images: product.images,
      });
    } catch (err) {
      console.error("Clear product images error:", err);
      res.status(500).json({ message: "Failed to clear images" });
    }
  }
);


/***********************************************************************
 *  HOME PRODUCTS (TOP 20)
 ***********************************************************************/

module.exports = router;
