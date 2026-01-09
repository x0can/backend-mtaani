/**
 * Normalize Kenyan numbers → +2547XXXXXXXX
 */
function normalizePhone(phone) {
  if (!phone) return null;

  let p = phone.replace(/\s+/g, "");

  if (p.startsWith("0")) return "+254" + p.slice(1);
  if (p.startsWith("254")) return "+" + p;
  if (p.startsWith("+")) return p;

  return null;
}

/**
 * Generate 6-digit OTP
 */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  normalizePhone,
  generateOtp,
};
