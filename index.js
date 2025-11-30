const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const http = require('http');            // NEW
const { Server } = require('socket.io'); // NEW
const path = require('path');            // NEW

const routes = require('./routes');

require('dotenv').config();

const app = express();

// Middlewares
app.use(express.json());
app.use(morgan('dev'));
app.use(cors());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ---- Config ---- */
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.DB;

/* ---- DB Connection ---- */
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

/* ---- Routes ---- */
app.use(routes);

/* ---- Socket.io ---- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // adjust for production
  },
});

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  // Client can "join" a room for a specific order
  socket.on('order:join', (orderId) => {
    if (!orderId) return;
    socket.join(`order:${orderId}`);
  });

  // Rider sends location updates
  socket.on('rider:location', (data) => {
    const { orderId, lat, lng } = data || {};
    if (!orderId || typeof lat !== 'number' || typeof lng !== 'number') return;

    // Broadcast to everyone watching this order
    io.to(`order:${orderId}`).emit('order:location', { orderId, lat, lng });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// server.js
app.use((req, res, next) => {
  req.io = io;
  next();
});


/* ---- Start ---- */
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

module.exports = { app, io };
