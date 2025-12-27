const cacheEvents = require("../cache/events");

cacheEvents.on("cache:set", ({ key, namespace }) => {
  console.log(`🟢 cache:set [${namespace}] ${key}`);
});

cacheEvents.on("cache:del", ({ key }) => {
  console.log(`🟠 cache:del ${key}`);
});

cacheEvents.on("cache:namespace:del", ({ namespace, count }) => {
  console.log(`🔴 cache:clear [${namespace}] (${count} keys)`);
});
