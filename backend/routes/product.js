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

const EVENTS = require("../events/productEvents");

const updateFlashDeal = require("../handlers/flashDeal");

/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/
// router.get("/api/products/home", async (req, res) => {
//   try {
//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Number(req.query.limit) || 20, 50);

//     // how many pages to batch in one request
//     const batchPages = Math.min(Number(req.query.batchPages) || 1, 3000);

//     const skip = (page - 1) * limit;
//     const batchLimit = limit * batchPages;

//     const query = {
//       deleted: { $ne: true },
//       $or: [{ isActive: true }, { isActive: { $exists: false } }],
//       $or: [{ stock: { $gt: 0 } }, { stock: { $exists: false } }],
//     };

//     const [products, total] = await Promise.all([
//       Product.find(query)
//         .select({
//           title: 1,
//           price: 1,
//           images: 1,
//           featured: 1,
//           featuredOrder: 1,
//           isFlashDeal: 1,
//           category: 1,
//           discount: 1,
//           stock: 1,
//           createdAt: 1,
//         })
//         .populate("category", "name slug")
//         .sort({
//           featured: -1,
//           featuredOrder: 1,
//           isFlashDeal: -1,
//           createdAt: -1,
//           _id: 1, // stable sort (IMPORTANT)
//         })
//         .skip(skip)
//         .limit(batchLimit)
//         .lean(),

//       Product.countDocuments(query),
//     ]);

//     const nextPage = page + batchPages;
//     const hasMore = skip + products.length < total;

//     res.json({
//       data: products,
//       meta: {
//         page,
//         limit,
//         batchPages,
//         nextPage,
//         total,
//         hasMore,
//       },
//     });
//   } catch (err) {
//     console.error("❌ Home products error:", err);
//     res.status(500).json({ message: "Failed to load home products" });
//   }
// });

// routes/products.js
router.get("/api/products/home", async (req, res) => {
  try {
    const cacheKey = "products:home:v3";
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

    // tune these numbers
    const HERO_LIMIT = 6;
    const FLASH_LIMIT = 10;
    const QUICK_LIMIT = 12;
    const FEATURED_LIMIT = 24;
    const NEW_LIMIT = 24;

    // Query in parallel
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

      Product.find({
        $or: [{ discount: { $gt: 10 } }, { featured: true }],
      })
        .select(projection)
        .populate("category", "name slug")
        .sort({ discount: -1, priceUpdatedAt: -1, createdAt: -1 })
        .limit(QUICK_LIMIT)
        .lean(),

      Product.find({})
        .select(projection)
        .populate("category", "name slug")
        .sort({ createdAt: -1 })
        .limit(NEW_LIMIT)
        .lean(),
    ]);

    const hero =
      featured.length > 0
        ? featured.slice(0, HERO_LIMIT)
        : newArrivals.slice(0, HERO_LIMIT);

    const payload = {
      hero,
      flashDeals,
      quickPicks,
      featured,
      newArrivals,
      meta: {
        version: "v3",
        generatedAt: new Date().toISOString(),
      },
    };

    await setCache(cacheKey, payload, 300, "products:home");
    res.json(payload);
  } catch (err) {
    console.error("Home products error:", err);
    res.status(500).json({ message: "Failed to load home products" });
  }
});

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
// router.put(
//   "/api/products/:id/flash-deal",
//   authMiddleware,
//   adminOnly,
//   async (req, res) => {
//     try {
//       const { enabled, discountPercent, startAt, endAt } = req.body;

//       /* =========================
//          VALIDATION
//       ========================= */
//       if (enabled) {
//         const discount = Number(discountPercent);

//         if (!Number.isFinite(discount) || discount <= 0 || discount > 90) {
//           return res.status(400).json({
//             message: "Discount percent must be between 1 and 90",
//           });
//         }

//         if (!startAt || !endAt) {
//           return res.status(400).json({
//             message: "Flash deal start and end dates are required",
//           });
//         }

//         const start = new Date(startAt);
//         const end = new Date(endAt);

//         if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
//           return res.status(400).json({
//             message: "Invalid date format",
//           });
//         }

//         if (start >= end) {
//           return res.status(400).json({
//             message: "End date must be after start date",
//           });
//         }
//       }

//       /* =========================
//          UPDATE PAYLOAD
//       ========================= */
//       const update = enabled
//         ? {
//             isFlashDeal: true,
//             priceUpdatedAt: new Date(), // 🔥 forces resort in cached lists
//             flashDeal: {
//               discountPercent: Number(discountPercent),
//               startAt: new Date(startAt),
//               endAt: new Date(endAt),
//             },
//           }
//         : {
//             isFlashDeal: false,
//             priceUpdatedAt: new Date(), // 🔥 forces resort
//             flashDeal: null,
//           };

//       /* =========================
//          DB UPDATE
//       ========================= */
//       const product = await Product.findByIdAndUpdate(req.params.id, update, {
//         new: true,
//       }).populate("category");

//       if (!product) {
//         return res.status(404).json({ message: "Product not found" });
//       }

//       /* =========================
//          CACHE INVALIDATION (CRITICAL)
//       ========================= */
//       await Promise.all([
//         delCacheByNamespace("products:home"),
//         delCacheByNamespace("products:list"), // 🔥 THIS FIXES THE BUG
//       ]);

//       /* =========================
//          REAL-TIME EVENT (OPTIONAL)
//       ========================= */
//       if (req.io) {
//         req.io.emit("product:flash-deal-updated", {
//           productId: product._id,
//           isFlashDeal: product.isFlashDeal,
//           flashDeal: product.flashDeal,
//         });
//       }

//       res.json(product);
//     } catch (err) {
//       console.error("❌ Flash deal update error:", err);
//       res.status(500).json({
//         message: "Failed to update flash deal",
//       });
//     }
//   }
// );

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
