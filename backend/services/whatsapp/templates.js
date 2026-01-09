/**
 * WhatsApp template payload builders
 * Must match templates created in Meta dashboard
 */

function otpTemplate({ code }) {
  return {
    name: "phone_otp_v1",
    language: { code: "en" },
    components: [
      {
        type: "body",
        parameters: [{ type: "text", text: code }],
      },
    ],
  };
}

function shippedTemplate({ name, orderId }) {
  return {
    name: "order_shipped_v1",
    language: { code: "en" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: name },
          { type: "text", text: orderId },
        ],
      },
    ],
  };
}

module.exports = {
  otpTemplate,
  shippedTemplate,
};
