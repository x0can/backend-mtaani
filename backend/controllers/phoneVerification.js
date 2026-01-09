const { User } = require("../db");
const { generateOtp, hashOtp } = require("../utils/otp");
const { sendOtp: sendWhatsAppOtp } = require("../services/whatsapp");

/**
 * Normalize Kenyan phone → +2547XXXXXXXX
 */
const normalizeKenyanPhone = (phone) => {
  if (!phone) return null;

  let p = phone.replace(/\s+/g, "");

  if (p.startsWith("0")) p = "+254" + p.slice(1);
  if (p.startsWith("254")) p = "+" + p;

  if (!p.startsWith("+254")) return null;
  return p;
};

/* =====================================================
   SEND PHONE OTP (WhatsApp ONLY)
===================================================== */
exports.sendPhoneOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user || !user.phone) {
      return res.status(400).json({ message: "Phone number not found" });
    }

    // already verified
    if (user.verified) {
      return res.json({ message: "Phone already verified" });
    }

    // ⏱ Rate limit: 30 seconds
    if (
      user.phoneOtpLastSentAt &&
      Date.now() - user.phoneOtpLastSentAt.getTime() < 30_000
    ) {
      return res
        .status(429)
        .json({ message: "Please wait before requesting another code" });
    }

    const phone = normalizeKenyanPhone(user.phone);
    if (!phone) {
      return res.status(400).json({ message: "Invalid phone number format" });
    }

    const otp = generateOtp();

    // 🔐 Save OTP (hashed)
    user.phoneOtpHash = hashOtp(otp);
    user.phoneOtpExpiresAt = Date.now() + 5 * 60 * 1000;
    user.phoneOtpLastSentAt = new Date();
    user.phoneOtpAttempts = 0;

    await user.save();

    // 📲 Send via WhatsApp
    await sendWhatsAppOtp({
      phone,
      code: otp,
    });

    res.json({
      success: true,
      channel: "whatsapp",
      message: "Verification code sent via WhatsApp",
    });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({
      message: "Failed to send verification code",
    });
  }
};

/* =====================================================
   VERIFY PHONE OTP
===================================================== */
exports.verifyPhoneOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({ message: "Code is required" });
    }

    const user = await User.findById(userId);

    if (!user || !user.phoneOtpHash) {
      return res.status(400).json({ message: "No verification in progress" });
    }

    // ⛔ Too many attempts
    if (user.phoneOtpAttempts >= 5) {
      return res
        .status(429)
        .json({ message: "Too many attempts. Request a new code." });
    }

    // ⏰ Expired
    if (!user.phoneOtpExpiresAt || user.phoneOtpExpiresAt < Date.now()) {
      return res.status(400).json({ message: "Code expired" });
    }

    const hashedCode = hashOtp(code);

    if (hashedCode !== user.phoneOtpHash) {
      user.phoneOtpAttempts += 1;
      await user.save();

      return res.status(400).json({ message: "Invalid code" });
    }

    // ✅ VERIFIED
    user.verified = true;

    user.phoneOtpHash = null;
    user.phoneOtpExpiresAt = null;
    user.phoneOtpLastSentAt = null;
    user.phoneOtpAttempts = 0;

    await user.save();

    res.json({
      success: true,
      verified: true,
      message: "Phone verified successfully",
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ message: "Failed to verify code" });
  }
};
