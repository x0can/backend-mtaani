const EVENTS = require("../events/productEvents");
const { delCacheByNamespace, redis } = require("./cache");
const { ProductEventLog } = require("../db");

const DEDUPE_TTL = 10;

function buildIdempotencyKey(event, payload) {
  return `${event}:${JSON.stringify(payload)}`;
}

async function alreadyHandled(key) {
  const redisKey = `__dedupe__:${key}`;
  if (await redis.get(redisKey)) return true;
  await redis.set(redisKey, 1, { ex: DEDUPE_TTL });
  return false;
}

async function handleProductEvent(event, payload, io, actorId) {
  const idempotencyKey = buildIdempotencyKey(event, payload);
  if (await alreadyHandled(idempotencyKey)) return;

  try {
    await ProductEventLog.create({
      type: event,
      productId: payload?.productId,
      actorId: actorId || null,
      payload,
      idempotencyKey,
    });
  } catch (err) {
    if (String(err?.code) !== "11000") {
      console.error("❌ ProductEventLog error:", err);
    }
  }

  switch (event) {
    case EVENTS.PRODUCT_FLASH_UPDATED:
    case EVENTS.PRODUCT_FEATURED_UPDATED: {
      await Promise.all([
        delCacheByNamespace("products:home"),
        delCacheByNamespace("products:list"),
      ]);

      // 🔥 EMIT EXACT SAME EVENT NAME
      io.emit(event, payload);
      break;
    }

    default:
      console.warn("⚠ Unknown product event:", event);
  }
}

module.exports = { handleProductEvent };
