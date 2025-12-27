const { Product } = require("../db");
const EVENTS = require("../events/productEvents");

module.exports = async function updateFlashDeal({
  productId,
  payload,
  emit,
}) {
  const update = payload.enabled
    ? {
        isFlashDeal: true,
        priceUpdatedAt: new Date(),
        flashDeal: {
          discountPercent: Number(payload.discountPercent),
          startAt: new Date(payload.startAt),
          endAt: new Date(payload.endAt),
        },
      }
    : {
        isFlashDeal: false,
        priceUpdatedAt: new Date(),
        flashDeal: null,
      };

  const product = await Product.findByIdAndUpdate(productId, update, {
    new: true,
  }).populate("category");

  if (!product) throw new Error("Product not found");

  emit(EVENTS.PRODUCT_FLASH_UPDATED, {
    productId: product._id,
    flashDeal: product.flashDeal,
    updatedAt: new Date(),
  });

  return product;
};
