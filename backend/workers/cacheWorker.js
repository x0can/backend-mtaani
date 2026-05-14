const { redis } = require("../services/cache");
const { STREAM_KEY } = require("../services/cache/stream");
const { delCacheByNamespace } = require("../services/cache");
const EVENTS = require("../events/productEvents");
const { warmHomeCache } = require("../services/cache/warmers/productWarmers");

let running = false;
let lastId = "$";

const RETRY_DELAY_MS = 30_000; // back off 30 s on any error

async function handleProductEvent(type, payload) {
  switch (type) {
    case EVENTS.PRODUCT_CREATED:
    case EVENTS.PRODUCT_UPDATED:
    case EVENTS.PRODUCT_DELETED:
    case EVENTS.PRODUCT_FLASH_DEAL_UPDATED:
    case EVENTS.PRODUCT_FEATURED_UPDATED:
      console.log("🔥 Invalidating product caches due to", type);
      await Promise.all([
        delCacheByNamespace("products:home"),
        delCacheByNamespace("products:list"),
        delCacheByNamespace("products:search"),
      ]);
      await warmHomeCache();
      break;

    default:
      break;
  }
}

async function startCacheWorker() {
  if (running) return;
  running = true;

  console.log("🟢 Cache worker started");

  while (running) {
    try {
      const res = await redis.xread(
        "BLOCK",
        5000,
        "COUNT",
        10,
        "STREAMS",
        STREAM_KEY,
        lastId
      );

      if (!res) continue;

      for (const stream of res) {
        for (const [id, data] of stream.messages) {
          lastId = id;
          const type = data.type;
          const payload = JSON.parse(data.payload || "{}");
          await handleProductEvent(type, payload);
        }
      }
    } catch (err) {
      const msg = err?.message ?? "";
      if (msg.includes("max requests limit exceeded") || msg.includes("ERR max")) {
        console.warn("⚠️  Cache worker: Upstash rate limit hit — pausing for 5 min");
        await sleep(5 * 60 * 1000);
      } else {
        console.error("❌ Cache worker error:", msg, "— retrying in 30 s");
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { startCacheWorker };
