const mongoose = require("mongoose");
const { Product } = require(".");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb+srv://xocan:waveLike8ese@cluster0.d56yh2c.mongodb.net";

mongoose.set("strictQuery", true);

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    await Product.deleteMany({ "metadata.importSource": "excel" });

    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
