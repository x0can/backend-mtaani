const express = require("express");
const axios = require("axios");
const router = express.Router();

const { getMpesaToken, generatePassword } = require("../mpesa/mpesa");
const { updateOrderPayment } = require("../controllers/orderController");

/* ------------------------------------------------------------------
   STK PUSH INITIATE
------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------
   M-PESA CALLBACK (FIXED)
------------------------------------------------------------------ */
router.post("/api/mpesa/callback", async (req, res) => {
  try {
    const io = req.app.get("io"); // ⭐ available because server.js set it

    const callback = req.body.Body.stkCallback;
    console.log("🔥 CALLBACK RECEIVED:", JSON.stringify(callback, null, 2));

    const resultCode = callback.ResultCode;
    const resultDesc = callback.ResultDesc;

    // Extract order ID from AccountReference = ORDER-123
    let accountRef;
    try {
      accountRef = callback?.CallbackMetadata?.Item?.find(
        (i) => i.Name === "AccountReference"
      )?.Value;
    } catch {}

    const orderId = accountRef?.replace("ORDER-", "");
    console.log("🧾 Extracted Order ID:", orderId);

    // --- Build payment info object ---
    let paymentInfo;

    if (resultCode === 0) {
      const items = callback.CallbackMetadata.Item;
      paymentInfo = {
        status: "PAID",
        amount: items.find((i) => i.Name === "Amount")?.Value,
        receipt: items.find((i) => i.Name === "MpesaReceiptNumber")?.Value,
        phone: items.find((i) => i.Name === "PhoneNumber")?.Value,
        date: items.find((i) => i.Name === "TransactionDate")?.Value,
      };
    } else {
      paymentInfo = {
        status: "FAILED",
        reason: resultDesc,
      };
    }

    // --- Save order update in DB ---
    const updatedOrder = await updateOrderPayment(orderId, paymentInfo);

    // --- Emit real-time update to the order room ---
    if (updatedOrder) {
      io.to(`order:${orderId}`).emit("order:paymentUpdate", {
        orderId,
        status: updatedOrder.status,       // "paid" or "cancelled"
        paymentInfo: updatedOrder.paymentInfo,
      });

      console.log(`📡 Emitted payment update to room order:${orderId}`);
    }

    res.json({ ResultCode: 0, ResultDesc: "Callback ok" });
  } catch (error) {
    console.error("❌ Callback error:", error);
    res.json({ ResultCode: 1, ResultDesc: "Callback failed" });
  }
});


module.exports = router;
