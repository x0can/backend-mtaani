// backend/mpesa/auth.js
const axios = require("axios");

exports.getDarajaToken = async () => {
  try {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;

    if (!key || !secret) {
      throw new Error("Missing Daraja credentials");
    }

    const auth = Buffer.from(`${key}:${secret}`).toString("base64");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    return response.data.access_token;

  } catch (err) {
    console.error("❌ Daraja OAuth Token Error:", err.response?.data || err);
    throw new Error("Failed to generate OAuth token");
  }
};
