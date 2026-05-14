const { Redis } = require("@upstash/redis");
const cacheEvents = require("./events");
const { publishCacheEvent } = require("./stream");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── Circuit breaker ───────────────────────────────────────────────────────────
// When Upstash is unavailable (rate-limited, network error, etc.) we flip this
// flag off and all cache operations become silent no-ops until it recovers.
let cacheAvailable = true;
let disabledUntil = 0;
const BACKOFF_MS = 5 * 60 * 1000; // 5 minutes before retrying

function isAvailable() {
  if (cacheAvailable) return true;
  if (Date.now() >= disabledUntil) {
    cacheAvailable = true;
    console.log("🔄 Cache: retrying Upstash after backoff period");
    return true;
  }
  return false;
}

function handleCacheError(err, op) {
  const msg = err?.message ?? "";
  if (msg.includes("max requests limit exceeded") || msg.includes("ERR max")) {
    if (cacheAvailable) {
      cacheAvailable = false;
      disabledUntil = Date.now() + BACKOFF_MS;
      console.warn(`⚠️  Upstash rate limit hit during '${op}' — cache disabled for 5 min`);
    }
  } else {
    console.error(`❌ Cache error [${op}]:`, msg);
  }
}

// ── Cache operations ──────────────────────────────────────────────────────────

const trackKey = async (namespace, key) => {
  if (!isAvailable()) return;
  try {
    await redis.sadd(`__keys__:${namespace}`, key);
  } catch (err) {
    handleCacheError(err, "trackKey");
  }
};

const getCache = async (key) => {
  if (!isAvailable()) return null;
  try {
    return await redis.get(key);
  } catch (err) {
    handleCacheError(err, "getCache");
    return null;
  }
};

const setCache = async (key, value, ttl = 300, namespace = "default") => {
  if (!isAvailable()) return;
  try {
    await redis.set(key, value, { ex: ttl });
    await trackKey(namespace, key);
    await publishCacheEvent("cache.set", { key, namespace, ttl });
  } catch (err) {
    handleCacheError(err, "setCache");
  }
};

const delCache = async (key) => {
  if (!isAvailable()) return;
  try {
    await redis.del(key);
    await publishCacheEvent("cache.del", { key });
  } catch (err) {
    handleCacheError(err, "delCache");
  }
};

const delCacheByNamespace = async (namespace) => {
  if (!isAvailable()) return;
  try {
    const indexKey = `__keys__:${namespace}`;
    const keys = await redis.smembers(indexKey);
    if (keys?.length) {
      await redis.del(...keys);
    }
    await redis.del(indexKey);
    await publishCacheEvent("cache.namespace.clear", {
      namespace,
      count: keys?.length || 0,
    });
  } catch (err) {
    handleCacheError(err, "delCacheByNamespace");
  }
};

module.exports = {
  redis,
  getCache,
  setCache,
  delCache,
  delCacheByNamespace,
  isCacheAvailable: () => isAvailable(),
};
