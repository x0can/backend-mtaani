const axios = require("axios");

const BASE_URL = "https://graph.facebook.com/v20.0";
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const TOKEN = process.env.WA_ACCESS_TOKEN;

if (!PHONE_NUMBER_ID || !TOKEN) {
  console.warn("⚠️ WhatsApp env vars missing");
}

const waClient = axios.create({
  baseURL: `${BASE_URL}/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

module.exports = waClient;
