// services/presenceService.js
const { User } = require("../db");

const PRESENCE_TIMEOUT_MS = parseInt(
  process.env.PRESENCE_TIMEOUT_MS || "30000",
  10
); // 30s default

const PRESENCE_SWEEP_INTERVAL_MS = parseInt(
  process.env.PRESENCE_SWEEP_INTERVAL_MS || "15000",
  10
); // check every 15s

function startPresenceMonitor(io) {
  console.log("⚡ Presence monitor started...");

  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - PRESENCE_TIMEOUT_MS);

      /* -----------------------------------------------------
         RIDERS OFFLINE DETECTION
      ----------------------------------------------------- */
      const staleRiders = await User.find({
        role: "rider",
        isOnline: true,
        $or: [
          { lastHeartbeat: { $lt: cutoff } },
          { lastHeartbeat: null }
        ],
      }).select("_id");

      if (staleRiders.length > 0) {
        const riderIds = staleRiders.map((u) => u._id);

        await User.updateMany(
          { _id: { $in: riderIds } },
          {
            isOnline: false,
            lastSeen: new Date(),
          }
        );

        riderIds.forEach((id) => {
          io.emit("rider:offline", {
            riderId: id,
            lastSeen: new Date().toISOString(),
          });
        });

        console.log(`🔻 Presence: Marked ${riderIds.length} rider(s) offline.`);
      }

      /* -----------------------------------------------------
         CUSTOMERS OFFLINE DETECTION
      ----------------------------------------------------- */
      const staleCustomers = await User.find({
        role: "customer",
        isOnline: true,
        $or: [
          { lastHeartbeat: { $lt: cutoff } },
          { lastHeartbeat: null }
        ],
      }).select("_id");

      if (staleCustomers.length > 0) {
        const customerIds = staleCustomers.map((u) => u._id);

        await User.updateMany(
          { _id: { $in: customerIds } },
          {
            isOnline: false,
            lastSeen: new Date(),
          }
        );

        customerIds.forEach((id) => {
          io.emit("customer:offline", {
            customerId: id,
            lastSeen: new Date().toISOString(),
          });
        });

        console.log(
          `🔻 Presence: Marked ${customerIds.length} customer(s) offline.`
        );
      }

    } catch (err) {
      console.error("Presence monitor error:", err);
    }
  }, PRESENCE_SWEEP_INTERVAL_MS);
}

module.exports = { startPresenceMonitor };
