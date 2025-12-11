const { Order } = require("../db");

exports.updateOrderPayment = async (orderId, update) => {
  try {
    console.log("Updating order:", orderId, update);

    const order = await Order.findById(orderId);
    if (!order) {
      console.log("Order not found:", orderId);
      return null;
    }

    // Set status
    if (update.status === "PAID") {
      order.status = "paid";
    } else if (update.status === "FAILED") {
      order.status = "cancelled";
    }

    // Store payment data
    order.paymentInfo = update;

    await order.save();

    console.log("✅ ORDER UPDATED SUCCESSFULLY");
    return order;
  } catch (err) {
    console.error("❌ Failed to update order:", err);
  }
};
