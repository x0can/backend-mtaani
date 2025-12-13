const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const getCache = async (key) => {
  return await redis.get(key);
};

const setCache = async (key, value, ttl = 300) => {
  await redis.set(key, value, { ex: ttl });
};

const delCache = async (key) => {
  await redis.del(key);
};

module.exports = {
  redis,
  getCache,
  setCache,
  delCache,
};
