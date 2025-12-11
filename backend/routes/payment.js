// routes/paymentRoutes.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

const { getMpesaToken, generatePassword } = require("../mpesa/mpesa");

router.post("/api/payments/mpesa/stk", async (req, res) => {
  try {
    const { phone, amount, orderId } = req.body;

    const sanitizedPhone = phone.replace(/^0/, "254");

    const token = await getMpesaToken();
    const { password, timestamp } = generatePassword();

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: sanitizedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: sanitizedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: `ORDER-${orderId}`,
      TransactionDesc: "Payment for Order",
    };

    const stkRes = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(stkRes.data);
  } catch (err) {
    console.error("Mpesa STK failed:", err.response?.data || err);
    res.status(500).json({
      message: "Mpesa STK failed",
      details: err.response?.data || err.message,
    });
  }
});

router.post("/api/mpesa/callback", (req, res) => {
  console.log("🔔 M-PESA CALLBACK RECEIVED: ", req.body);

  // You can store the STK payment result in DB here

  res.json({ message: "Callback received" });
});


module.exports = router;
