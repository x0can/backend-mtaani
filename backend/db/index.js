const mongoose = require("mongoose");

/* ---- Schemas & Models ---- */
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false }, // keep as-is for now
    phone: { type: String, required: true },
    role: { type: String, enum: ["customer", "rider"], default: "customer" },

    // NEW: verification flag
    verified: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },

    // NEW: rider location
    currentLocation: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },

    // NEW: rider assignments
    assignedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  },
  { timestamps: true }
);
;

const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    images: [String],
    metadata: mongoose.Schema.Types.Mixed,
    category: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory" }, // NEW
  },
  { timestamps: true }
);

ProductSchema.index({ title: "text", description: "text" });

const ProductCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    image: String, // optional image for UI
  },
  { timestamps: true }
);

const ProductCategory = mongoose.model(
  "ProductCategory",
  ProductCategorySchema
);


const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: { type: Number, required: true, min: 1 },
  priceAtPurchase: { type: Number, required: true },
});

const OrderSchema = new mongoose.Schema({
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
}, { timestamps: true });


const User = mongoose.model("User", UserSchema);
const Product = mongoose.model("Product", ProductSchema);
const Order = mongoose.model("Order", OrderSchema);

exports.User = User;
exports.Product = Product;
exports.Order = Order;
exports.ProductCategory = ProductCategory;

