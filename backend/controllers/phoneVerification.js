const { User } = require("../db");
const { generateOtp, hashOtp } = require("../utils/otp");
const { sendSms } = require("../services/sms");

const normalizeKenyanPhone = (phone) => {
  if (!phone) return null;

  let p = phone.replace(/\s+/g, "");

  if (p.startsWith("0")) {
    p = "+254" + p.slice(1);
  }

  if (p.startsWith("254")) {
    p = "+" + p;
  }

  if (!p.startsWith("+254")) {
    return null;
  }

  return p;
};

/* ---------------- SEND OTP ---------------- */
exports.sendPhoneOtp = async (req, res) => {
  console.log("🔥 AT_USERNAME =", JSON.stringify(process.env.AT_USERNAME));
  console.log("🔥 AT_API_KEY length =", process.env.AT_API_KEY?.length);
  console.log("🔥 NODE_ENV =", process.env.NODE_ENV);

  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user || !user.phone) {
      return res.status(400).json({ message: "Phone number not found" });
    }

    // Already verified → no OTP needed
    if (user.verified) {
      return res.json({ message: "Phone already verified" });
    }

    // ⏱ Rate limit: 30s
    // if (
    //   user.phoneOtpLastSentAt &&
    //   Date.now() - user.phoneOtpLastSentAt.getTime() < 30_000
    // ) {
    //   return res
    //     .status(429)
    //     .json({ message: "Please wait before requesting another code" });
    // }

    const otp = generateOtp();

    user.phoneOtpHash = hashOtp(otp);
    user.phoneOtpExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    user.phoneOtpLastSentAt = new Date();
    user.phoneOtpAttempts = 0; // 🔐 reset attempts

    await user.save();

    const phone = normalizeKenyanPhone(user.phone);

    if (!phone) {
      return res.status(400).json({ message: "Invalid phone number format" });
    }

    await sendSms(
      phone,
      `Your Mtaani verification code is ${otp}. It expires in 5 minutes.`
    );

    res.json({ message: "Verification code sent" });
  } catch (err) {
    console.error("Send OTP error:", {
      message: err?.message,
      status: err?.status,
      data: err?.response?.data,
      stack: err?.stack,
    });

    return res.status(500).json({
      message: "Failed to send verification code",
      // comment out in prod if you want, but keep for now while debugging:
      debug: err?.message || "unknown",
    });
  }
};

/* ---------------- VERIFY OTP ---------------- */
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

    res.json({ message: "Phone verified successfully" });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ message: "Failed to verify code" });
  }
};
