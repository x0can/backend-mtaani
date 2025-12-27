const { redis } = require("./index");

const STREAM_KEY = "cache.events";

/**
 * Publish cache event to Redis Stream
 */
// services/cache/stream.js
async function publishCacheEvent(event, payload) {
  // Upstash REST does NOT support Redis streams
  // This is intentionally a no-op for now
  console.log("📦 cache event:", event, payload);
}

module.exports = { publishCacheEvent };


module.exports = {
  STREAM_KEY,
  publishCacheEvent,
};
