const waClient = require("./client");
const { normalizePhone } = require("./utils");
const templates = require("./templates");

/**
 * Send WhatsApp template message
 */
async function sendTemplateMessage({ to, template }) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Invalid phone number");

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template,
  };

  const res = await waClient.post("/messages", payload);
  return res.data;
}

/**
 * Send OTP via WhatsApp
 */
async function sendOtp({ phone, code }) {
  return sendTemplateMessage({
    to: phone,
    template: templates.otpTemplate({ code }),
  });
}

/**
 * Send order shipped message
 */
async function sendOrderShipped({ phone, name, orderId }) {
  return sendTemplateMessage({
    to: phone,
    template: templates.shippedTemplate({ name, orderId }),
  });
}

module.exports = {
  sendOtp,
  sendOrderShipped,
  sendTemplateMessage, // exposed for future use
};
