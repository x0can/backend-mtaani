const { delCacheByNamespace } = require("./cache");

module.exports = async function invalidateProductCaches() {
  await Promise.all([
    delCacheByNamespace("products:home"),
    delCacheByNamespace("products:list"),
    delCacheByNamespace("products:search"),
  ]);
};
