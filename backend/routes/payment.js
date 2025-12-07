// routes/paymentRoutes.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

const { authMiddleware } = require("../auth");

router.post("/api/payments/mpesa/stk", authMiddleware, async (req, res) => {
  try {
    const { phone, amount, orderId } = req.body;

    const { getMpesaToken, generatePassword } = require("../mpesa");

    const token = await getMpesaToken();
    const { password, timestamp } = generatePassword();

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: "https://dummyurl.com",
      AccountReference: `ORDER-${orderId}`,
      TransactionDesc: "Payment",
    };

    const stkRes = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(stkRes.data);
  } catch (err) {
    console.error("Mpesa STK failed:", err);
    res.status(500).json({ message: "Mpesa STK failed" });
  }
});

module.exports = router;
