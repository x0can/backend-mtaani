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
  console.log("🔥 BUS RECEIVED:", event, payload); // ✅ ADD THIS

  const idempotencyKey = buildIdempotencyKey(event, payload);
  if (await alreadyHandled(idempotencyKey)) return;

  try {
    await ProductEventLog.create({
      type: event,
      productId: payload?.productId || null,
      actorId: actorId || payload?.userId || null,
      payload,
      idempotencyKey,
    });
  } catch (err) {
    if (String(err?.code) !== "11000") {
      console.error("❌ ProductEventLog error:", err);
    }
  }

  switch (event) {
    /* --------------------------------------------------
       PRODUCT STATE CHANGES (GLOBAL)
    -------------------------------------------------- */
    case EVENTS.PRODUCT_FLASH_UPDATED:
    case EVENTS.PRODUCT_FEATURED_UPDATED: {
      await Promise.all([
        delCacheByNamespace("products:home"),
        delCacheByNamespace("products:list"),
      ]);

      io.emit(event, payload);
      break;
    }

    /* --------------------------------------------------
       USER INTERACTION (PERSONALIZED)
    -------------------------------------------------- */
    case EVENTS.USER_INTERACTION: {
      const userId = payload?.userId;
      if (!userId) break;

      // 🔥 ONLY invalidate that user's home cache
      await redis.del(`products:home:v5:user:${userId}`);

      // 🔥 Emit only to that user (room-based)
      io.to(`user:${userId}`).emit(event, payload);
      break;
    }

    default:
      console.warn("⚠ Unknown product event:", event);
  }
}

module.exports = { handleProductEvent };
