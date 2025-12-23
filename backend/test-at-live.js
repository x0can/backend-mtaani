/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");

// ⚠️ adjust path if needed
const { Product } = require("./db");

const MONGO_URI = "mongodb+srv://xocan:waveLike8ese@cluster0.d56yh2c.mongodb.net/"

async function run() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);

    console.log("✅ Connected");

    // 🔍 Count affected products first
    const before = await Product.countDocuments({
      $or: [
        { stock: { $exists: false } },
        { stock: { $lte: 0 } },
      ],
    });

    console.log(`📦 Products with stock <= 0: ${before}`);

    if (before === 0) {
      console.log("🎉 Nothing to update. Exiting.");
      process.exit(0);
    }

    // 🚀 Update
    const res = await Product.updateMany(
      {
        $or: [
          { stock: { $exists: false } },
          { stock: { $lte: 0 } },
        ],
      },
      {
        $set: { stock: 100 },
      }
    );

    console.log(`🛠 Updated ${res.modifiedCount} products`);

    // ✅ Verify
    const after = await Product.countDocuments({
      stock: { $lte: 0 },
    });

    console.log(`🔎 Remaining stock <= 0: ${after}`);
    console.log("✅ Migration completed successfully");

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

run();
