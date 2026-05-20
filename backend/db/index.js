// db.js
const mongoose = require("mongoose");

/* ---- User Schema ---- */
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    phone: { type: String, default: "" },

    googleId: { type: String, default: null, sparse: true },
    facebookId: { type: String, default: null, sparse: true },

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
    // phone verification (OTP)
    phoneOtpHash: { type: String, default: null },
    phoneOtpExpiresAt: { type: Date, default: null },
    phoneOtpLastSentAt: { type: Date, default: null },
    phoneOtpAttempts: { type: Number, default: 0 },

    emailOtpHash: { type: String, default: null },
    emailOtpExpiresAt: { type: Date, default: null },
    emailOtpLastSentAt: { type: Date, default: null },
    emailVerified: { type: Boolean, default: false },

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
    categoryPreferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory" }],
  },
  { timestamps: true }
);

// Helpful indexes (optional but recommended)
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ emailOtpExpiresAt: 1 });
UserSchema.index({ phoneOtpExpiresAt: 1 });
UserSchema.index({ emailVerified: 1 });
UserSchema.index({ verified: 1 });

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
    title: { type: String, required: true, trim: true },

    /* ---------------- PRICING ---------------- */
    price: { type: Number, required: true }, // SELLING price
    priceUpdatedAt: { type: Date, default: Date.now },

    cost: { type: Number, default: 0 }, // 🔥 avg cost snapshot

    priceHistory: [
      {
        price: Number,
        changedAt: { type: Date, default: Date.now },
        source: {
          type: String,
          enum: ["manual", "import", "sync"],
          default: "import",
        },
      },
    ],

    /* ---------------- INVENTORY ---------------- */
    stock: { type: Number, default: 0 },
    uom: { type: String, default: "PCS" },

    /* ---------------- MEDIA ---------------- */
    images: [String],

    /* ---------------- CATEGORY ---------------- */
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
      index: true,
    },

    featured: { type: Boolean, default: false },
    featuredOrder: { type: Number, default: null },

    isQuickPick: { type: Boolean, default: false },
    quickPickOrder: { type: Number, default: null },

    isActive: { type: Boolean, default: true },
    likeCount: { type: Number, default: 0 },

    isFlashDeal: { type: Boolean, default: false },
    flashDealOrder: { type: Number, default: null },
    flashDeal: {
      discountPercent: { type: Number, min: 1, max: 90 },
      startAt: Date,
      endAt: Date,
    },

    lowStockThreshold: { type: Number, default: 5 },

    /* ---------------- METADATA ---------------- */
    metadata: {
      itemNumber: {
        type: String,
        index: true,
        sparse: true, // allows missing values
      },

      avgCost: Number,
      value: Number,
      turnover: Number,

      lastImported: Date,
      importSource: { type: String, default: "excel" },
    },

    barcode: { type: String, sparse: true, index: true },
    sku: { type: String, sparse: true, index: true },
  },
  { timestamps: true }
);

ProductSchema.pre("save", function (next) {
  if (this.isModified("price")) {
    this.priceUpdatedAt = new Date();

    this.priceHistory.push({
      price: this.price,
      source: "manual",
    });
  }
  next();
});

ProductSchema.index({ title: "text" });
ProductSchema.index({ price: 1 });
ProductSchema.index({ stock: 1 });
ProductSchema.index({ isActive: 1 });
ProductSchema.index({ featured: 1, featuredOrder: 1 });
ProductSchema.index({ isFlashDeal: 1 });

const ProductEventLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, required: false },
    actorId: { type: mongoose.Schema.Types.ObjectId, required: false }, // admin user
    payload: { type: Object, default: {} },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

/* ---- Product Interaction ---- */
const ProductInteractionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      index: true,
    },

    type: {
      type: String,
      enum: ["view", "add_to_cart", "order", "search_click", "like"],
      required: true,
    },

    weight: { type: Number, default: 1 }, // dynamic scoring
  },
  { timestamps: true }
);

ProductInteractionSchema.index({ user: 1, product: 1 });
ProductInteractionSchema.index({ product: 1, type: 1 });

const ProductInteraction = mongoose.model(
  "ProductInteraction",
  ProductInteractionSchema
);

/* ---- Orders ---- */
const OrderItemSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true }, // 👈 important

  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: { type: Number, required: true, min: 1 },
  priceAtPurchase: { type: Number, required: true },

  fulfilledQuantity: { type: Number, default: null },
  availability: {
    type: String,
    enum: ["available", "missing"],
    default: "available",
  },

  adminNote: String,
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
    originalTotal: { type: Number, required: true, immutable: true },

    finalTotal: { type: Number, default: null },

    fulfillmentStatus: {
      type: String,
      enum: ["pending", "reviewed"],
      default: "pending",
    },
    adjustments: [
      {
        type: {
          type: String,
          enum: ["add_item", "remove_item", "manual"],
          required: true,
        },
        amount: { type: Number, required: true }, // + or -
        note: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

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
/* ---- Search History ---- */
const SearchHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    query: { type: String, index: true },

    matchedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true }
);

const SearchHistory = mongoose.model("SearchHistory", SearchHistorySchema);

/* ---- Admin Recommendations ---- */
const AdminRecommendationSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      unique: true,
    },

    priority: { type: Number, default: 0 }, // higher = stronger push
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const AdminRecommendation = mongoose.model(
  "AdminRecommendation",
  AdminRecommendationSchema
);

/* ---- Walk-in Customer ---- */
const WalkInCustomerSchema = new mongoose.Schema(
  {
    name: String,
    phone: { type: String, index: true },
    email: String,
    loyaltyPoints: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    visitCount: { type: Number, default: 0 },
    lastVisit: Date,
  },
  { timestamps: true }
);

/* ---- Shift ---- */
const ShiftSchema = new mongoose.Schema(
  {
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    openingFloat: { type: Number, default: 0 },
    closingFloat: { type: Number, default: null },
    expectedFloat: Number,
    cashDrops: [
      {
        amount: Number,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    status: { type: String, enum: ["open", "closed"], default: "open" },
    summary: {
      totalSales: { type: Number, default: 0 },
      totalCash: { type: Number, default: 0 },
      totalMpesa: { type: Number, default: 0 },
      totalCard: { type: Number, default: 0 },
      transactionCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/* ---- POS Sale ---- */
const POSSaleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  title: String, // snapshot
  barcode: String, // snapshot
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  lineTotal: Number,
});

const PaymentEntrySchema = new mongoose.Schema({
  method: { type: String, enum: ["cash", "mpesa", "card"], required: true },
  amount: { type: Number, required: true },
  reference: String, // e.g. M-Pesa receipt
});

const POSSaleSchema = new mongoose.Schema(
  {
    saleNumber: { type: String, unique: true },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "WalkInCustomer" },
    items: [POSSaleItemSchema],
    subtotal: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    payments: [PaymentEntrySchema],
    change: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ["cash", "mpesa", "card", "split"],
      required: true,
    },
    status: {
      type: String,
      enum: ["completed", "voided", "refunded"],
      default: "completed",
    },
    voidReason: String,
    refundReason: String,
    loyaltyPointsEarned: { type: Number, default: 0 },
    loyaltyPointsRedeemed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

POSSaleSchema.index({ cashier: 1 });
POSSaleSchema.index({ shift: 1 });
POSSaleSchema.index({ status: 1 });
POSSaleSchema.index({ createdAt: 1 });

/* ---- Inventory Transaction ---- */
const InventoryTransactionSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    type: {
      type: String,
      enum: ["restock", "sale", "pos_sale", "adjustment", "return", "waste", "transfer"],
      required: true,
    },
    quantity: { type: Number, required: true }, // positive = in, negative = out
    previousStock: Number,
    newStock: Number,
    unitCost: Number,
    reference: String, // PO number, sale number, etc.
    note: String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

InventoryTransactionSchema.index({ product: 1 });
InventoryTransactionSchema.index({ type: 1 });
InventoryTransactionSchema.index({ createdAt: 1 });

/* ---- Supplier ---- */
const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    contactName: String,
    phone: String,
    email: String,
    address: String,
    taxId: String,
    paymentTerms: { type: String, default: "Net 30" },
    active: { type: Boolean, default: true },
    notes: String,
  },
  { timestamps: true }
);

/* ---- Purchase Order ---- */
const POLineItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  productName: String, // snapshot
  quantity: { type: Number, required: true },
  receivedQuantity: { type: Number, default: 0 },
  unitCost: { type: Number, required: true },
  lineTotal: Number,
});

const PurchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    items: [POLineItemSchema],
    status: {
      type: String,
      enum: ["draft", "sent", "partial", "received", "cancelled"],
      default: "draft",
    },
    orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    orderedAt: Date,
    receivedAt: Date,
    expectedAt: Date,
    notes: String,
    totalCost: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ---- Discount ---- */
const DiscountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, uppercase: true, sparse: true, unique: true },
    type: { type: String, enum: ["percentage", "fixed", "bogo"], required: true },
    value: { type: Number, required: true }, // % or KES
    minOrderAmount: { type: Number, default: 0 },
    maxUses: Number,
    usedCount: { type: Number, default: 0 },
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: "ProductCategory" }],
    startAt: Date,
    endAt: Date,
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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

const ProductEventLog = mongoose.model(
  "ProductEventLog",
  ProductEventLogSchema
);

const WalkInCustomer = mongoose.model("WalkInCustomer", WalkInCustomerSchema);
const Shift = mongoose.model("Shift", ShiftSchema);
const POSSale = mongoose.model("POSSale", POSSaleSchema);
const InventoryTransaction = mongoose.model("InventoryTransaction", InventoryTransactionSchema);
const Supplier = mongoose.model("Supplier", SupplierSchema);
const PurchaseOrder = mongoose.model("PurchaseOrder", PurchaseOrderSchema);
const Discount = mongoose.model("Discount", DiscountSchema);

module.exports = {
  User,
  Product,
  Order,
  ProductCategory,
  ProductEventLog,
  ProductInteraction,
  SearchHistory,
  AdminRecommendation,
  POSSale,
  Shift,
  InventoryTransaction,
  Supplier,
  PurchaseOrder,
  Discount,
  WalkInCustomer,
};
