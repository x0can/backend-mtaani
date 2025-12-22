/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const { Product } = require("./db");

const MONGO_URI = "mongodb+srv://xocan:waveLike8ese@cluster0.d56yh2c.mongodb.net/"

async function migrateProducts() {
  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);

  console.log("🚀 Starting product migration...");

  const updates = {
    // add missing flags safely
    isActive: true,
    isFlashDeal: false,
    lowStockThreshold: 5,
  };

  /* --------------------------------------------------
     1️⃣ Add missing simple fields
  -------------------------------------------------- */
  const baseResult = await Product.updateMany(
    {
      $or: [
        { isActive: { $exists: false } },
        { isFlashDeal: { $exists: false } },
        { lowStockThreshold: { $exists: false } },
      ],
    },
    {
      $set: updates,
    }
  );

  console.log(
    `✅ Base fields updated: ${baseResult.modifiedCount}`
  );

  /* --------------------------------------------------
     2️⃣ Normalize flashDeal
  -------------------------------------------------- */
  const flashResult = await Product.updateMany(
    {
      isFlashDeal: true,
      flashDeal: { $exists: false },
    },
    {
      $set: { flashDeal: null },
    }
  );

  console.log(
    `🔥 Flash deal normalized: ${flashResult.modifiedCount}`
  );

  /* --------------------------------------------------
     3️⃣ Normalize featured fields
  -------------------------------------------------- */
  const featuredResult = await Product.updateMany(
    {
      featured: { $exists: false },
    },
    {
      $set: {
        featured: false,
        featuredOrder: null,
      },
    }
  );

  console.log(
    `⭐ Featured fields normalized: ${featuredResult.modifiedCount}`
  );

  console.log("🎉 Product migration completed successfully");
  process.exit(0);
}

/* --------------------------------------------------
   Run
-------------------------------------------------- */
migrateProducts().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
