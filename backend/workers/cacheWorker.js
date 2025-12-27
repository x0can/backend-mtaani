const { redis } = require("../services/cache");
const { STREAM_KEY } = require("../services/cache/stream");
const { delCacheByNamespace } = require("../services/cache");
const EVENTS = require("../events/productEvents");
const { warmHomeCache } = require("../services/cache/warmers/productWarmers");

let running = false;
let lastId = "$";

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
  }
}

module.exports = { startCacheWorker };
