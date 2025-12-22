module.exports = function recalculateOrderTotal(order) {
  let total = 0;

  for (const item of order.items) {
    const qty =
      typeof item.fulfilledQuantity === "number"
        ? item.fulfilledQuantity
        : item.quantity;

    if (item.availability === "missing") continue;

    total += qty * item.priceAtPurchase;
  }

  order.finalTotal = total;
  order.total = total; // UI compatibility
};
