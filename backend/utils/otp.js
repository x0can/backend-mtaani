const crypto = require("crypto");

const generateOtp = () => {
  // 4-digit numeric OTP
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const hashOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

module.exports = {
  generateOtp,
  hashOtp,
};
