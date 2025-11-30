/***********************************************************************
 * ROUTES.JS — CLEAN REWRITE
 * Cloudinary Uploads • Auth • Users • Products • Orders • Stats • Riders
 ***********************************************************************/

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const axios = require("axios");

const { User, Product, Order, ProductCategory } = require("../db");
const {
  generateToken,
  hashPassword,
  authMiddleware,
  adminOnly,
} = require("../auth");

/***********************************************************************
 *  CLOUDINARY UPLOAD (MULTER)
 ***********************************************************************/
const cloudinary = require("../cloudinary");

const tempDir = path.join(__dirname, "..", "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

router.post(
  "/api/upload",
  authMiddleware,
  adminOnly,
  upload.single("image"),
  async (req, res) => {
    try {
      const uploadRes = await cloudinary.uploader.upload(req.file.path, {
        folder: "ecommerce",
      });

      fs.unlinkSync(req.file.path); // cleanup temp file
      res.json({ url: uploadRes.secure_url });
    } catch (err) {
      console.error("Upload Error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

/***********************************************************************
 *  HEALTH CHECK
 ***********************************************************************/
router.get("/health", (req, res) => res.json({ status: "ok" }));

/***********************************************************************
 *  AUTH — REGISTER & LOGIN
 ***********************************************************************/
router.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!name || !email || !password || !phone)
      return res.status(400).json({ message: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already in use" });

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      isAdmin: false,
      role: role === "rider" ? "rider" : "customer",
    });

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
      },
    });
  } catch (err) {
    console.error("Registration failed:", err);
    res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = generateToken(user);
    res.json({
      token,
      user,
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/***********************************************************************
 *  USER PROFILE
 ***********************************************************************/
router.get("/api/me", authMiddleware, (req, res) => res.json(req.user));

router.put("/api/me", authMiddleware, async (req, res) => {
  try {
    if (req.body.name) req.user.name = req.body.name;
    await req.user.save();
    res.json(req.user);
  } catch (err) {
    console.error("Profile update failed:", err);
    res.status(400).json({ message: "Profile update failed" });
  }
});

/***********************************************************************
 *  ADMIN — USER MANAGEMENT
 ***********************************************************************/
router.get("/api/admin/users", authMiddleware, adminOnly, async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

// VERIFY USER
router.patch(
  "/api/admin/users/:id/verify",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.verified = true;
    await user.save();
    res.json({ success: true, user });
  }
);

// PROMOTE TO RIDER
router.patch(
  "/api/admin/users/:id/promote-rider",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.role = "rider";
    await user.save();
    res.json({ success: true, user });
  }
);

// ACTIVATE/SUSPEND USER
router.patch(
  "/api/admin/users/:id/status",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.active = !user.active;
    await user.save();

    res.json({ success: true, user });
  }
);

/***********************************************************************
 *  CATEGORIES
 ***********************************************************************/
router.get("/api/categories", async (req, res) => {
  const categories = await ProductCategory.find();
  res.json(categories);
});

router.post(
  "/api/categories",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const category = await ProductCategory.create(req.body);
      res.status(201).json(category);
    } catch (err) {
      console.error("Create category failed:", err);
      res.status(400).json({ message: "Invalid category data" });
    }
  }
);

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

/***********************************************************************
 *  PRODUCTS CRUD (ADMIN + SEARCH)
 ***********************************************************************/
router.get("/api/products", async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      const regex = new RegExp(search, "i");
      query = {
        $or: [{ title: { $regex: regex } }, { description: { $regex: regex } }],
      };
    }

    const products = await Product.find(query).populate("category");
    res.json(products);
  } catch (err) {
    console.error("Fetch products failed:", err);
    res.status(500).json({ message: "Failed to load products" });
  }
});

router.post(
  "/api/products",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const product = await Product.create(req.body);
      res.status(201).json(product);
    } catch (err) {
      console.error("Create product failed:", err);
      res.status(400).json({ message: "Invalid product data" });
    }
  }
);

router.put(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json(product);
  }
);

router.delete(
  "/api/products/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Deleted" });
  }
);

router.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/***********************************************************************
 *  ORDERS (CREATE + LIST + DETAILS + UPDATE)
 ***********************************************************************/
router.post("/api/orders", authMiddleware, async (req, res) => {
  try {
    const { items = [], shippingAddress = {} } = req.body;
    if (!items.length)
      return res.status(400).json({ message: "No items" });

    const productIds = items.map((i) => i.product);
    const prods = await Product.find({ _id: { $in: productIds } });
    const prodMap = {};
    prods.forEach((p) => (prodMap[p._id] = p));

    let total = 0;
    const orderItems = items.map((i) => {
      const p = prodMap[i.product];
      const qty = Math.max(1, Number(i.quantity));
      total += p.price * qty;

      return {
        product: p._id,
        quantity: qty,
        priceAtPurchase: p.price,
      };
    });

    const order = await Order.create({
      user: req.user._id,
      items: orderItems,
      total,
      shippingAddress,
    });

    const populated = await Order.findById(order._id)
      .populate("user", "name email")
      .populate({
        path: "items.product",
        populate: { path: "category" },
      });

    res.status(201).json(populated);
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(400).json({ message: "Order creation failed" });
  }
});

// LIST ORDERS (admin = all, others = own)
router.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const query = req.user.isAdmin ? {} : { user: req.user._id };

    const orders = await Order.find(query)
      .populate("user", "name email phone")
      .populate("rider", "name email phone")
      .populate({
        path: "items.product",
        populate: { path: "category" },
      })
      .sort("-createdAt");

    res.json(orders);
  } catch (err) {
    console.error("Fetch orders failed:", err);
    res.status(500).json({ message: "Failed to load orders" });
  }
});

// ORDER DETAILS
router.get("/api/orders/:id", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("rider", "name email phone")
      .populate({
        path: "items.product",
        populate: { path: "category" },
      });

    if (!order)
      return res.status(404).json({ message: "Order not found" });

    const isAdmin = req.user.isAdmin;
    const isOwner = String(order.user._id) === String(req.user._id);
    const isAssignedRider =
      order.rider && String(order.rider._id) === String(req.user._id);

    if (!isAdmin && !isOwner && !isAssignedRider) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(order);
  } catch (err) {
    console.error("Get order failed:", err);
    res.status(500).json({ message: "Failed to load order" });
  }
});

/***********************************************************************
 *  UPDATE ORDER STATUS — ADMIN / RIDER / CUSTOMER
 *  Policy: C (Admin full; assigned rider limited; customer cancel only)
 ***********************************************************************/
router.put("/api/orders/:id", authMiddleware, async (req, res) => {
  try {
    const { status, rider: riderIdFromBody } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order)
      return res.status(404).json({ message: "Order not found" });

    const validStatuses = [
      "created",
      "paid",
      "shipped",
      "completed",
      "cancelled",
    ];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const userId = String(req.user._id);
    const isOwner = String(order.user) === userId;
    const isRider = req.user.role === "rider";
    const isAssignedRider = order.rider && String(order.rider) === userId;
    const isAdmin = req.user.isAdmin;

    /************************************************************
     * ADMIN — CAN DO ANYTHING (status + change rider via body)
     ************************************************************/
    if (isAdmin) {
      if (typeof riderIdFromBody !== "undefined") {
        const riderDoc = await User.findById(riderIdFromBody);
        if (!riderDoc || riderDoc.role !== "rider") {
          return res.status(400).json({ message: "Invalid rider" });
        }
        order.rider = riderDoc._id;
      }

      if (status) {
        order.status = status;
      }

      await order.save();
      const updated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      return res.json({ success: true, order: updated });
    }

    /************************************************************
     * RIDER — CAN UPDATE ONLY IF ASSIGNED
     * Allowed statuses: shipped, completed, paid
     ************************************************************/
    if (isRider) {
      if (!isAssignedRider) {
        return res.status(403).json({ message: "Not your assigned order" });
      }

      if (!status) {
        return res
          .status(400)
          .json({ message: "Status is required for rider update" });
      }

      const riderAllowed = ["shipped", "completed", "paid"];
      if (!riderAllowed.includes(status)) {
        return res.status(403).json({
          message: "Riders cannot change to this status",
        });
      }

      order.status = status;
      await order.save();

      const updated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      return res.json({ success: true, order: updated });
    }

    /************************************************************
     * CUSTOMER — CAN ONLY CANCEL THEIR OWN ORDER
     ************************************************************/
    if (isOwner) {
      if (status !== "cancelled") {
        return res.status(403).json({
          message: "Customers can only cancel their orders",
        });
      }

      order.status = "cancelled";
      await order.save();

      const updated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      return res.json({ success: true, order: updated });
    }

    /************************************************************
     * IF NONE MATCH
     ************************************************************/
    return res.status(403).json({ message: "Forbidden" });
  } catch (err) {
    console.error("Order update failed:", err);
    res.status(500).json({ message: "Order update failed" });
  }
});

/***********************************************************************
 *  RIDER: ROUTE PLAN (OPTIONAL)
 ***********************************************************************/
router.post("/api/rider/destination", authMiddleware, async (req, res) => {
  try {
    const { start, end } = req.body;

    if (!start || !end)
      return res.status(400).json({ message: "Start and end are required" });

    // NOTE: routePlan is not in schema; Mongoose will ignore unless schema updated.
    req.user.routePlan = { start, end };
    await req.user.save();

    res.json({ success: true, routePlan: req.user.routePlan });
  } catch (err) {
    console.log("Route save error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/***********************************************************************
 *  M-PESA STK PUSH (NO CALLBACK)
 ***********************************************************************/
router.post("/api/payments/mpesa/stk", authMiddleware, async (req, res) => {
  try {
    const { phone, amount, orderId } = req.body;

    const { getMpesaToken, generatePassword } = require("../mpesa");

    const token = await getMpesaToken();
    const { password, timestamp } = generatePassword();

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: "https://dummyurl.com",
      AccountReference: `ORDER-${orderId}`,
      TransactionDesc: "Payment",
    };

    const stkRes = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(stkRes.data);
  } catch (err) {
    console.error("Mpesa STK failed:", err);
    res.status(500).json({ message: "Mpesa STK failed" });
  }
});

/***********************************************************************
 *  RIDER: LIVE LOCATION / ORDERS / DELIVERY
 ***********************************************************************/

/**
 * Update rider location (Admin or Rider) + broadcast via Socket.io
 * Expects: { lat, lng, orderId? }
 */
router.post("/api/rider/location", authMiddleware, async (req, res) => {
  try {
    const { lat, lng, orderId } = req.body;

    if (req.user.role !== "rider" && !req.user.isAdmin)
      return res
        .status(403)
        .json({ message: "Forbidden — riders or admins only" });

    if (typeof lat !== "number" || typeof lng !== "number")
      return res.status(400).json({ message: "Coordinates invalid" });

    const rider = await User.findById(req.user._id);
    rider.currentLocation = { lat, lng };
    await rider.save();

    // Broadcast globally
    if (req.io) {
      req.io.emit("rider:location", {
        riderId: rider._id,
        name: rider.name,
        lat,
        lng,
      });

      // If tied to an order, broadcast to room
      if (orderId) {
        req.io.to(`order:${orderId}`).emit("order:rider-location", {
          orderId,
          lat,
          lng,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Location update failed:", err);
    res.status(500).json({ message: "Location update failed" });
  }
});

/**
 * Admin: riders + their orders
 */
router.get(
  "/api/admin/riders/with-orders",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const riders = await User.find({ role: "rider" })
        .select("name email phone isOnline")
        .lean();

      const orders = await Order.find({ rider: { $ne: null } })
        .populate("rider", "name phone email")
        .populate("user", "name phone email")
        .sort("-createdAt");

      res.json({ riders, orders });
    } catch (err) {
      console.error("Failed to load rider orders:", err);
      res.status(500).json({ message: "Failed to load rider orders" });
    }
  }
);

/**
 * Get rider orders
 * - Rider sees their own orders
 * - Admin can pass ?riderId=xxxx
 */
router.get("/api/riders/orders", authMiddleware, async (req, res) => {
  try {
    const riderId = req.user.isAdmin
      ? req.query.riderId || req.user._id
      : req.user._id;

    const orders = await Order.find({ rider: riderId })
      .populate("user", "name email phone")
      .populate("rider", "name email phone")
      .populate({
        path: "items.product",
        populate: { path: "category" },
      })
      .sort("-createdAt");

    res.json(orders);
  } catch (err) {
    console.error("Failed to fetch rider orders:", err);
    res.status(500).json({ message: "Failed to fetch rider orders" });
  }
});

/***********************************************************************
 *  ASSIGN RIDER TO ORDER (ADMIN ONLY)
 ***********************************************************************/
router.post(
  "/api/orders/:orderId/assign-rider",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { riderId } = req.body;

      if (!riderId) {
        return res.status(400).json({ message: "riderId is required" });
      }

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const rider = await User.findById(riderId);
      if (!rider || rider.role !== "rider") {
        return res.status(400).json({ message: "Invalid rider" });
      }

      // Assign order to rider
      order.rider = riderId;
      order.status = "shipped"; // or "assigned" if you add that status
      await order.save();

      // Track assignment on rider doc
      rider.assignedOrders = rider.assignedOrders || [];
      if (!rider.assignedOrders.find((id) => String(id) === String(order._id))) {
        rider.assignedOrders.push(order._id);
      }
      await rider.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({
        success: true,
        message: "Rider assigned successfully",
        order: populated,
      });
    } catch (err) {
      console.error("Assign-rider error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/***********************************************************************
 *  RIDER ORDER ACTIONS
 ***********************************************************************/

// Rider marks order as completed (or Admin)
router.put(
  "/api/orders/:orderId/complete",
  authMiddleware,
  async (req, res) => {
    try {
      const { orderId } = req.params;

      if (req.user.role !== "rider" && !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (!req.user.isAdmin && String(order.rider) !== String(req.user._id)) {
        return res.status(403).json({ message: "Not your assigned order" });
      }

      order.status = "completed";
      await order.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({ success: true, order: populated });
    } catch (err) {
      console.error("Complete order failed:", err);
      res.status(500).json({ message: "Failed to complete order" });
    }
  }
);

// RIDER ACCEPTS ORDER (Admin allowed to simulate)
router.post(
  "/api/rider/orders/:orderId/accept",
  authMiddleware,
  async (req, res) => {
    const { orderId } = req.params;

    try {
      const order = await Order.findById(orderId);
      if (!order)
        return res.status(404).json({ message: "Order not found" });

      if (
        String(order.rider) !== String(req.user._id) &&
        !req.user.isAdmin
      ) {
        return res.status(403).json({ message: "Not assigned to you" });
      }

      order.status = "shipped";
      await order.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({ success: true, order: populated });
    } catch (err) {
      console.error("Failed to accept order:", err);
      res.status(500).json({ message: "Failed to accept order" });
    }
  }
);

// RIDER MARKS ORDER DELIVERED
router.post(
  "/api/rider/orders/:orderId/deliver",
  authMiddleware,
  async (req, res) => {
    const { orderId } = req.params;

    try {
      const order = await Order.findById(orderId);
      if (!order)
        return res.status(404).json({ message: "Order not found" });

      if (
        String(order.rider) !== String(req.user._id) &&
        !req.user.isAdmin
      ) {
        return res.status(403).json({ message: "Not assigned to you" });
      }

      order.status = "completed";
      await order.save();

      const populated = await Order.findById(order._id)
        .populate("user", "name email phone")
        .populate("rider", "name email phone")
        .populate({
          path: "items.product",
          populate: { path: "category" },
        });

      res.json({ success: true, order: populated });
    } catch (err) {
      console.error("Failed to deliver order:", err);
      res.status(500).json({ message: "Failed to deliver order" });
    }
  }
);

/***********************************************************************
 *  RIDER ONLINE / OFFLINE
 ***********************************************************************/
router.post("/api/rider/online", authMiddleware, async (req, res) => {
  if (req.user.role !== "rider" && !req.user.isAdmin)
    return res.status(403).json({ message: "Forbidden" });

  req.user.isOnline = true;
  await req.user.save();

  res.json({ success: true });
});

router.post("/api/rider/offline", authMiddleware, async (req, res) => {
  if (req.user.role !== "rider" && !req.user.isAdmin)
    return res.status(403).json({ message: "Forbidden" });

  req.user.isOnline = false;
  await req.user.save();

  res.json({ success: true });
});

/***********************************************************************
 *  ADMIN — ANALYTICS & REPORTING
 ***********************************************************************/
router.get(
  "/api/admin/stats/overview",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const totalUsers = await User.countDocuments();
      const totalProducts = await Product.countDocuments();
      const totalOrders = await Order.countDocuments();

      const revenueAgg = await Order.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, revenue: { $sum: "$total" } } },
      ]);

      const revenue = revenueAgg[0]?.revenue || 0;

      const riders = await User.countDocuments({
        role: "rider",
        verified: true,
      });

      res.json({
        totalUsers,
        totalProducts,
        totalOrders,
        revenue,
        riders,
      });
    } catch (err) {
      console.error("Stats overview failed:", err);
      res.status(500).json({ message: "Failed to load stats" });
    }
  }
);

/***********************************************************************
 *  ERROR HANDLER
 ***********************************************************************/
router.use((err, req, res, next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ message: "Internal server error" });
});

module.exports = router;
