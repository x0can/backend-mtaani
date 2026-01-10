// controllers/emailVerification.js
const crypto = require("crypto");
const { User } = require("../db");
const { sendEmail } = require("../services/email");

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function hashOtp(email, otp) {
  const secret = process.env.JWT_SECRET || process.env.OTP_SECRET || "fallback_secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${email.toLowerCase()}|${otp}`)
    .digest("hex");
}

exports.sendEmailOtp = async (req, res) => {
  try {
    // ✅ body may be empty; authMiddleware already loaded user
    const email = (req.user?.email || req.body?.email || "").toLowerCase();

    if (!email) return res.status(400).json({ message: "Email missing" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.emailVerified) {
      return res.status(200).json({ message: "Email already verified" });
    }

    const ttlMinutes = Number(process.env.OTP_TTL_MINUTES || 10);
    const otp = generateOtp();

    user.emailOtpHash = hashOtp(email, otp);
    user.emailOtpExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    user.emailOtpLastSentAt = new Date();
    user.emailOtpAttempts = 0;
    await user.save();

    await sendEmail({
      to: email,
      subject: `${process.env.APP_NAME || "Mtaani"} verification code`,
      html: `<div style="font-family: Arial">
              <h2>Your OTP</h2>
              <p style="font-size:28px;font-weight:800;letter-spacing:4px">${otp}</p>
              <p>Expires in ${ttlMinutes} minutes.</p>
            </div>`,
      text: `Your OTP is ${otp}. Expires in ${ttlMinutes} minutes.`,
    });

    return res.json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("sendEmailOtp error:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
};

exports.verifyEmailOtp = async (req, res) => {
  try {
    const email = (req.user?.email || req.body?.email || "").toLowerCase();
    const otp = String(req.body?.otp || "").trim();

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.emailOtpHash || !user.emailOtpExpiresAt) {
      return res.status(400).json({ message: "Request a new OTP" });
    }

    if (new Date() > user.emailOtpExpiresAt) {
      console.log('expired', user.emailOtpExpiresAt)
      return res.status(400).json({ message: "OTP expired. Request a new OTP." });
    }

    const incomingHash = hashOtp(email, otp);
    const ok =
      incomingHash.length === user.emailOtpHash.length &&
      crypto.timingSafeEqual(Buffer.from(incomingHash, "hex"), Buffer.from(user.emailOtpHash, "hex"));

    if (!ok) {
      user.emailOtpAttempts = (user.emailOtpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // ✅ mark verified
    user.emailVerified = true;
    user.verified = true; // if you treat this as overall verification

    // clear otp
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;

    await user.save();

    const safeUser = await User.findById(user._id).select("-passwordHash");
    return res.json({ message: "Email verified", user: safeUser });
  } catch (err) {
    console.error("verifyEmailOtp error:", err);
    return res.status(500).json({ message: "Failed to verify OTP" });
  }
};
