const mongoose = require("mongoose");
const { Order } = require("./db");

(async () => {
  try {
    console.log("🔌 Connecting to MongoDB...");

    await mongoose.connect(
      "mongodb+srv://xocan:waveLike8ese@cluster0.d56yh2c.mongodb.net/",
      {}
    );

    console.log("✅ Connected");

    const result = await Order.updateMany(
      { originalTotal: { $exists: false } },
      [{ $set: { originalTotal: "$total" } }],
      { updatePipeline: true } // 🔥 REQUIRED
    );

    console.log("🛠 Migration result:");
    console.log(`Matched: ${result.matchedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);

    console.log("🎉 Migration complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
