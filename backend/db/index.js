// db.js
const mongoose = require("mongoose");

/* ---- User Schema ---- */
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    phone: { type: String, required: true },

    role: {
      type: String,
      enum: ["customer", "rider"],
      default: "customer",
    },

    // verification & status
    verified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },

    // presence
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    lastHeartbeat: { type: Date, default: null },

    // rider location
    currentLocation: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },

    // rider route plan (optional)
    routePlan: {
      start: { type: mongoose.Schema.Types.Mixed, default: null },
      end: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // rider assignments
    assignedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  },
  { timestamps: true }
);

/* ---- Product & Category ---- */
const ProductCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    image: String, // optional image for UI
  },
  { timestamps: true }
);

const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    images: [String],
    metadata: mongoose.Schema.Types.Mixed,
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
    },
  },
  { timestamps: true }
);

ProductSchema.index({ title: "text", description: "text" });

/* ---- Orders ---- */
const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: { type: Number, required: true, min: 1 },
  priceAtPurchase: { type: Number, required: true },
});

const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [OrderItemSchema],
    total: { type: Number, required: true },
    status: {
      type: String,
      enum: ["created", "paid", "shipped", "completed", "cancelled"],
      default: "created",
    },
    shippingAddress: mongoose.Schema.Types.Mixed,
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // assigned rider
    riderLocation: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/* ---- Models ---- */
const User = mongoose.model("User", UserSchema);
const Product = mongoose.model("Product", ProductSchema);
const Order = mongoose.model("Order", OrderSchema);
const ProductCategory = mongoose.model("ProductCategory", ProductCategorySchema);

module.exports = {
  User,
  Product,
  Order,
  ProductCategory,
};
