// routes/orderRoutes.js
const express = require("express");
const router = express.Router();

const { Order, Product, User } = require("../db");
const { authMiddleware, adminOnly } = require("../auth");
const { getCache, setCache, delCache } = require("../services/cache");
const recalculateOrderTotal = require("../utils/recalculateOrderTotal");

function assertAdminCanEditOrder(order) {
  if (!order) throw new Error("Order not found");
  if (["completed", "cancelled"].includes(order.status)) {
    const err = new Error("Order is locked");
    err.status = 400;
    throw err;
  }
}

/***********************************************************************
 *  ORDERS (CREATE + LIST + DETAILS + UPDATE)
 ***********************************************************************/
router.post("/api/orders", authMiddleware, async (req, res) => {
  try {
    const { items = [], shippingAddress = {} } = req.body;
    if (!items.length) return res.status(400).json({ message: "No items" });

    const productIds = items.map((i) => i.product);
    const prods = await Product.find({ _id: { $in: productIds } });
    await delCache(`orders:user:${req.user._id}`);
    await delCache("orders:admin");
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
      originalTotal: total,
      finalTotal: total,
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
  const cacheKey = req.user.isAdmin
    ? "orders:admin"
    : `orders:user:${req.user._id}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  const query = req.user.isAdmin ? {} : { user: req.user._id };

  const orders = await Order.find(query)
    .populate("user", "name email phone")
    .populate("rider", "name email phone")
    .populate({ path: "items.product", populate: { path: "category" } })
    .sort("-createdAt");

  await setCache(cacheKey, orders, 60); // cache for 60 seconds
  res.json(orders);
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

    if (!order) return res.status(404).json({ message: "Order not found" });

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
 ***********************************************************************/
router.put("/api/orders/:id", authMiddleware, async (req, res) => {
  try {
    const { status, rider: riderIdFromBody } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    await delCache(`orders:user:${req.user._id}`);
    await delCache("orders:admin");

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

    // ADMIN: can change anything + assign rider
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

    // RIDER: only if assigned, limited statuses
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

    // CUSTOMER: can only cancel own order
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

    return res.status(403).json({ message: "Forbidden" });
  } catch (err) {
    console.error("Order update failed:", err);
    res.status(500).json({ message: "Order update failed" });
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

      order.rider = riderId;
      order.status = "shipped";
      await order.save();

      rider.assignedOrders = rider.assignedOrders || [];
      if (
        !rider.assignedOrders.find((id) => String(id) === String(order._id))
      ) {
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
 *  RIDER / ADMIN: COMPLETE ORDER
 ***********************************************************************/
router.put(
  "/api/orders/:orderId/complete",
  authMiddleware,
  async (req, res) => {
    try {
      const { orderId } = req.params;

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const isAdmin = req.user.isAdmin;
      const isAssignedRider =
        order.rider && String(order.rider) === String(req.user._id);

      if (!isAdmin && !isAssignedRider) {
        return res.status(403).json({ message: "Forbidden" });
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

router.post(
  "/api/orders/:id/items",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { productId, quantity = 1 } = req.body;
      const order = await Order.findById(req.params.id).populate(
        "items.product"
      );
      assertAdminCanEditOrder(order);

      const product = await Product.findById(productId);
      if (!product)
        return res.status(404).json({ message: "Product not found" });

      const qty = Math.max(1, Number(quantity));
      const existing = order.items.find(
        (i) => String(i.product._id) === String(productId)
      );

      if (existing) {
        existing.quantity += qty;
      } else {
        order.items.push({
          product: product._id,
          quantity: qty,
          priceAtPurchase: product.price,
        });
      }

      order.adjustments.push({
        type: "add_item",
        amount: product.price * qty,
        note: `Added ${qty} x ${product.title}`,
        by: req.user._id,
      });

      recalculateOrderTotal(order);
      order.fulfillmentStatus = "pending";

      await order.save();
      await delCache("orders:admin");
      await delCache(`orders:user:${order.user}`);

      res.json({ success: true, order });
    } catch (err) {
      res.status(err.status || 500).json({ message: err.message });
    }
  }
);

/* ======================================================
   UPDATE ITEM QUANTITY
====================================================== */
router.put(
  "/api/orders/:id/items/:itemId",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const { quantity } = req.body;
    const order = await Order.findById(req.params.id).populate("items.product");
    assertAdminCanEditOrder(order);

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: "Item not found" });

    const oldQty = item.quantity;
    item.quantity = Math.max(1, Number(quantity));

    order.adjustments.push({
      type: "manual",
      amount: (item.quantity - oldQty) * item.priceAtPurchase,
      note: `Qty change ${oldQty} → ${item.quantity}`,
      by: req.user._id,
    });

    recalculateOrderTotal(order);
    order.fulfillmentStatus = "pending";

    await order.save();
    await delCache("orders:admin");
    await delCache(`orders:user:${order.user}`);

    res.json({ success: true, order });
  }
);

/* ======================================================
   DELETE ITEM
====================================================== */
router.delete(
  "/api/orders/:id/items/:itemId",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const order = await Order.findById(req.params.id).populate("items.product");
    assertAdminCanEditOrder(order);

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: "Item not found" });

    order.adjustments.push({
      type: "remove_item",
      amount: -(item.quantity * item.priceAtPurchase),
      note: `Removed ${item.product.title}`,
      by: req.user._id,
    });

    item.deleteOne();

    recalculateOrderTotal(order);
    order.fulfillmentStatus = "pending";

    await order.save();
    await delCache("orders:admin");
    await delCache(`orders:user:${order.user}`);

    res.json({ success: true, order });
  }
);

/* ======================================================
   FULFILLMENT REVIEW (FINAL PAYABLE)
====================================================== */
router.put(
  "/api/orders/:id/items",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "`items` must be an array" });
    }

    const order = await Order.findById(req.params.id).populate("items.product");
    assertAdminCanEditOrder(order);

    for (const orderItem of order.items) {
      const update = items.find(
        (i) => String(i.itemId) === String(orderItem._id)
      );
      if (!update) continue;

      orderItem.availability = update.availability || "available";
      orderItem.fulfilledQuantity =
        orderItem.availability === "missing"
          ? 0
          : Math.min(update.fulfilledQuantity, orderItem.quantity);
      orderItem.adminNote = update.adminNote || "";
    }

    order.fulfillmentStatus = "reviewed";
    recalculateOrderTotal(order);

    await order.save();
    await delCache("orders:admin");
    await delCache(`orders:user:${order.user}`);

    res.json({ success: true, order });
  }
);

module.exports = router;
