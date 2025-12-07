// routes/categoryRoutes.js
const express = require("express");
const router = express.Router();

const { ProductCategory } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");

router.get("/api/categories", async (req, res) => {
  const categories = await ProductCategory.find();
  res.json(categories);
});

router.post("/api/categories", authMiddleware, adminOnly, async (req, res) => {
  try {
    const category = await ProductCategory.create(req.body);
    res.status(201).json(category);
  } catch (err) {
    console.error("Create category failed:", err);
    res.status(400).json({ message: "Invalid category data" });
  }
});

router.put(
  "/api/categories/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const category = await ProductCategory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!category)
      return res.status(404).json({ message: "Category not found" });

    res.json(category);
  }
);

router.delete(
  "/api/categories/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const category = await ProductCategory.findByIdAndDelete(req.params.id);
    if (!category)
      return res.status(404).json({ message: "Category not found" });

    res.json({ message: "Deleted" });
  }
);

module.exports = router;
