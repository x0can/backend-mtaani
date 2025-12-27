const EventEmitter = require("events");

class CacheEventBus extends EventEmitter {}

module.exports = new CacheEventBus();
