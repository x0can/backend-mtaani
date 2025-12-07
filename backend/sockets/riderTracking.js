// src/sockets/riderTracking.js
const { User } = require("../db"); // adjust path as needed

module.exports = (io, socket) => {
  console.log("Rider connected:", socket.id);

  /* -------------------------------
     RIDER ONLINE
  --------------------------------*/
  socket.on("rider:online", async ({ userId }) => {
    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    io.emit("rider:online", { userId });
  });

  /* -------------------------------
     RIDER HEARTBEAT
  --------------------------------*/
  socket.on("rider:heartbeat", async ({ userId }) => {
    await User.findByIdAndUpdate(userId, {
      lastHeartbeat: new Date(),
      isOnline: true,
    });
  });

  /* -------------------------------
     UPDATE LOCATION
  --------------------------------*/
  socket.on("rider:updateLocation", async ({ userId, lat, lng }) => {
    await User.findByIdAndUpdate(userId, {
      currentLocation: { lat, lng },
    });

    io.emit("rider:location", { userId, lat, lng });
  });

  /* -------------------------------
     RIDER DISCONNECTS
  --------------------------------*/
  socket.on("disconnect", async () => {
    console.log("Rider disconnected:", socket.id);
  });
};
