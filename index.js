const express = require('express');
const mongoose = require('mongoose');
;
const morgan = require('morgan');
const routes = require('./routes');

/**
 * index.js - Node.js e-commerce boilerplate (single-file)
 *
 * Install dependencies:
 *   npm init -y
 *   npm i express mongoose bcryptjs jsonwebtoken dotenv morgan
 *
 * Usage:
 *   Create a .env with MONGO_URI and JWT_SECRET, then:
 *   node index.js
 */

require('dotenv').config();
const cors = require('cors');


const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors())

/* ---- Config ---- */
const PORT = process.env.PORT || 3000;
const MONGO_URI =  'mongodb+srv://alexmwaura43:waveLike8ese@cluster0.w1akjr0.mongodb.net/';


/* ---- DB Connection ---- */
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => {
        console.error('MongoDB connection error', err);
        process.exit(1);
    });




/* ---- Routes ---- */
app.use(routes);


/* ---- Start ---- */


app.listen(5000, '0.0.0.0', () => console.log('Server running'));


module.exports = app;

