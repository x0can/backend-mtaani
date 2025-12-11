const express = require("express");
const router = express.Router();
const { getDarajaToken } = require("../mpesa/auth");

router.get("/api/mpesa/test-token", async (req, res) => {
  try {
    const token = await getDarajaToken();
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
