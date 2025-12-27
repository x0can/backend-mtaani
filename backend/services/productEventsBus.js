const EVENTS = require("../events/productEvents");
const { delCacheByNamespace, redis } = require("./cache"); // Upstash redis client you already have
const {ProductEventLog} = require("../db/index");

// dedupe window (seconds)
const DEDUPE_TTL = 10;

// build a stable key to dedupe repeated events
function buildIdempotencyKey(event, payload) {
  // for bulk featured updates: one key per payload snapshot
  // for flash deal updates: one key per product + current flashDeal settings
  return `${event}:${JSON.stringify(payload)}`;
}

async function alreadyHandled(idempotencyKey) {
  // Use Upstash Redis for fast dedupe
  // setnx-like behavior via SET with NX is not supported the same way in Upstash REST client,
  // but we can emulate with `set` + `nx` option if supported; otherwise use `get` first.
  const existing = await redis.get(`__dedupe__:${idempotencyKey}`);
  if (existing) return true;

  await redis.set(`__dedupe__:${idempotencyKey}`, 1, { ex: DEDUPE_TTL });
  return false;
}

async function handleProductEvent(event, payload, io, actorId) {
  const idempotencyKey = buildIdempotencyKey(event, payload);

  // 1) Fast dedupe (prevents spam)
  const dup = await alreadyHandled(idempotencyKey);
  if (dup) return;

  // 2) Audit log (DB-level unique also dedupes)
  try {
    await ProductEventLog.create({
      type: event,
      productId: payload?.productId || undefined,
      actorId: actorId || undefined,
      payload,
      idempotencyKey,
    });
  } catch (e) {
    // If duplicate key, treat as already handled
    if (String(e?.code) === "11000") return;
    console.error("❌ audit log error:", e);
  }

  // 3) Side effects (your “microservice” behavior)
  switch (event) {
    case EVENTS.PRODUCT_FLASH_DEAL_UPDATED: {
      await Promise.all([
        delCacheByNamespace("products:home"),
        delCacheByNamespace("products:list"),
      ]);

      io.emit("product:flash-deal-updated", payload);
      break;
    }

    case EVENTS.PRODUCT_FEATURED_UPDATED: {
      await Promise.all([
        delCacheByNamespace("products:home"),
        delCacheByNamespace("products:list"),
      ]);

      io.emit("product:featured-updated", payload);
      break;
    }

    default:
      console.warn("⚠ Unknown product event:", event);
  }
}

module.exports = { handleProductEvent };
