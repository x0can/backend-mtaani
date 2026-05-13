// services/recommendations.js
const mongoose = require("mongoose");
const { Product, ProductInteraction, AdminRecommendation } = require("../db");

const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 7;

async function getRecommendedForUser(userId, limit = 12) {
  if (!userId) return [];

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const now = Date.now();

  /* -------------------------------
     1) TIME-DECAYED INTERACTIONS
  -------------------------------- */
  const interactions = await ProductInteraction.aggregate([
    { $match: { user: userObjectId } },
    {
      $addFields: {
        decay: {
          $exp: {
            $multiply: [
              -1,
              {
                $divide: [
                  { $subtract: [now, { $toLong: "$createdAt" }] },
                  HALF_LIFE_MS,
                ],
              },
            ],
          },
        },
      },
    },
    {
      $group: {
        _id: "$product",
        score: { $sum: { $multiply: ["$weight", "$decay"] } },
        lastInteractedAt: { $max: "$createdAt" },
      },
    },
    { $sort: { lastInteractedAt: -1, score: -1 } },
    { $limit: limit * 3 },
  ]);

  if (!interactions.length) return [];

  const interactedIds = interactions.map((i) => i._id);

  /* -------------------------------
     2) CATEGORY EXPANSION
  -------------------------------- */
  const categories = await Product.find({ _id: { $in: interactedIds } })
    .distinct("category");

  const categoryProducts = categories.length
    ? await Product.find({
        category: { $in: categories },
        _id: { $nin: interactedIds },
        isActive: true,
        stock: { $gt: 0 },
      })
        .limit(limit * 2)
        .lean()
    : [];

  /* -------------------------------
     3) ADMIN BOOST (SAFE)
  -------------------------------- */
  const adminBoost = await AdminRecommendation.find({ active: true })
    .sort({ priority: -1 })
    .limit(5)
    .populate("product");

  /* -------------------------------
     4) SCORE MERGE
  -------------------------------- */
  const scoreMap = new Map();
  const lastSeenMap = new Map();

  interactions.forEach((i) => {
    const k = String(i._id);
    scoreMap.set(k, i.score * 0.6);
    lastSeenMap.set(k, new Date(i.lastInteractedAt).getTime());
  });

  categoryProducts.forEach((p) => {
    const k = String(p._id);
    scoreMap.set(k, (scoreMap.get(k) || 0) + 0.25);
  });

  adminBoost.forEach((a) => {
    if (!a.product) return;
    const k = String(a.product._id);
    scoreMap.set(k, (scoreMap.get(k) || 0) + a.priority * 0.15);
  });

  // break ties per-user
  for (const [k, v] of scoreMap.entries()) {
    scoreMap.set(k, v + Math.random() * 0.02);
  }

  // primary sort: most recently interacted first; secondary: score
  const rankedIds = [...scoreMap.entries()]
    .sort((a, b) => {
      const tA = lastSeenMap.get(a[0]) || 0;
      const tB = lastSeenMap.get(b[0]) || 0;
      if (tB !== tA) return tB - tA;
      return b[1] - a[1];
    })
    .slice(0, limit)
    .map(([id]) => new mongoose.Types.ObjectId(id));

  /* -------------------------------
     5) HYDRATE + PRESERVE ORDER
  -------------------------------- */
  const products = await Product.find({
    _id: { $in: rankedIds },
    isActive: true,
    stock: { $gt: 0 },
  })
    .select({
      title: 1,
      price: 1,
      images: 1,
      featured: 1,
      featuredOrder: 1,
      isFlashDeal: 1,
      category: 1,
      priceUpdatedAt: 1,
      stock: 1,
      createdAt: 1,
    })
    .populate("category", "name slug")
    .lean();

  const map = new Map(products.map((p) => [String(p._id), p]));

  return rankedIds.map((id) => map.get(String(id))).filter(Boolean);
}

module.exports = { getRecommendedForUser };
