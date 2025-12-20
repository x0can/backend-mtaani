const AfricasTalking = require("africastalking");

const africastalking = AfricasTalking({
  username: process.env.AT_USERNAME,
  apiKey: process.env.AT_API_KEY,
});

const sms = africastalking.SMS;

exports.sendSms = async ({ to, message, requestId }) => {
  try {
    const response = await sms.send({
      to, // string or array → "+2547XXXXXXXX"
      message,
      from: process.env.AT_SENDER_ID,
      enqueue: 1,
      requestId, // optional but recommended
    });

    const data = response.SMSMessageData;

    const recipients = data.Recipients.map((r) => ({
      number: r.number,
      status: r.status,
      statusCode: r.statusCode,
      cost: r.cost,
      messageId: r.messageId,
    }));

    return {
      success: recipients.some(
        (r) => r.statusCode === 100 || r.statusCode === 101
      ),
      summary: data.Message,
      recipients,
    };
  } catch (error) {
    console.error("SMS send failed:", error);
    throw new Error("SMS_DELIVERY_FAILED");
  }
};
