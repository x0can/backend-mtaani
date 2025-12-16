const AfricasTalking = require("africastalking");

const africastalking = AfricasTalking({
  username: process.env.AT_USERNAME,
  apiKey: process.env.AT_API_KEY,
});


const sms = africastalking.SMS;

exports.sendSms = async (to, message) => {
  return sms.send({
    to: [to],
    message,
  });
};
