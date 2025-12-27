const { Product } = require("../../../db");
const { setCache } = require("../index");

async function warmHomeCache() {
  console.log("🔥 Warming home cache");

  const cacheKey = "products:home:v3";

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

  const [featured, flashDeals, quickPicks, newArrivals] = await Promise.all([
    Product.find({ featured: true })
      .select(projection)
      .populate("category", "name slug")
      .sort({ featuredOrder: 1, createdAt: -1 })
      .limit(24)
      .lean(),

    Product.find({ isFlashDeal: true })
      .select(projection)
      .populate("category", "name slug")
      .sort({ priceUpdatedAt: -1 })
      .limit(10)
      .lean(),

    Product.find({ discount: { $gt: 10 } })
      .select(projection)
      .populate("category", "name slug")
      .sort({ discount: -1 })
      .limit(12)
      .lean(),

    Product.find({})
      .select(projection)
      .populate("category", "name slug")
      .sort({ createdAt: -1 })
      .limit(24)
      .lean(),
  ]);

  const payload = {
    hero: featured.slice(0, 6),
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
}

module.exports = {
  warmHomeCache,
};
