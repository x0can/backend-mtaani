const axios = require("axios");

exports.generatePassword = () => {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;

  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:\.Z]/g, "")
    .slice(0, 14);

  const password = Buffer.from(shortcode + passkey + timestamp).toString("base64");

  return { timestamp, password };
};

exports.getMpesaToken = async () => {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  const res = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  return res.data.access_token;
};
