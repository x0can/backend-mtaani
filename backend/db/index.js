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

    // ⭐ ADD THIS
    image: { type: String, default: null },

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

    routePlan: {
      start: { type: mongoose.Schema.Types.Mixed, default: null },
      end: { type: mongoose.Schema.Types.Mixed, default: null },
    },

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
    priceUpdatedAt: { type: Date, default: Date.now }, // ⭐ NEW

    stock: { type: Number, default: 0 },
    images: [String],

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
    },

    // ⭐ ADMIN CURATION
    featured: { type: Boolean, default: false },
    featuredOrder: { type: Number, default: null }, // 1–20

    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

ProductSchema.pre("save", function (next) {
  if (this.isModified("price")) {
    this.priceUpdatedAt = new Date();
  }
  next();
});

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

    paymentInfo: mongoose.Schema.Types.Mixed, // ⭐ ADD THIS

    shippingAddress: mongoose.Schema.Types.Mixed,
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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
const ProductCategory = mongoose.model(
  "ProductCategory",
  ProductCategorySchema
);

module.exports = {
  User,
  Product,
  Order,
  ProductCategory,
};
