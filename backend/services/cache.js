const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Store cache key
 */
const trackKey = async (namespace, key) => {
  await redis.sadd(`__keys__:${namespace}`, key);
};

/**
 * Get cache
 */
const getCache = async (key) => {
  return await redis.get(key);
};

/**
 * Set cache + register key
 */
const setCache = async (key, value, ttl = 300, namespace = "default") => {
  await redis.set(key, value, { ex: ttl });
  await trackKey(namespace, key);
};

/**
 * Delete single cache
 */
const delCache = async (key) => {
  await redis.del(key);
};

/**
 * 🔥 Delete ALL cache keys in a namespace
 */
const delCacheByNamespace = async (namespace) => {
  const indexKey = `__keys__:${namespace}`;
  const keys = await redis.smembers(indexKey);

  if (keys?.length) {
    await redis.del(...keys);
  }

  // cleanup index
  await redis.del(indexKey);
};

module.exports = {
  redis,
  getCache,
  setCache,
  delCache,
  delCacheByNamespace,
};
