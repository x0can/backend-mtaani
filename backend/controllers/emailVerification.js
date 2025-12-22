const { User } = require("../db");
const { generateOtp, hashOtp } = require("../utils/otp");
const { sendEmail } = require("../services/email");

/* ---------------- SEND EMAIL OTP ---------------- */
exports.sendEmailOtp = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user || !user.email) {
      return res.status(400).json({ message: "Email not found" });
    }

    // 🔒 use ONE source of truth
    if (user.emailVerified === true) {
      return res.json({ message: "Email already verified" });
    }

    // ⏱ rate limit (30s)
    if (
      user.emailOtpLastSentAt &&
      Date.now() - user.emailOtpLastSentAt.getTime() < 30_000
    ) {
      return res.status(429).json({
        message: "Please wait before requesting another code",
      });
    }

    // 🔐 generate OTP
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // 📧 send email (Resend-style)
    const emailResult = await sendEmail({
      to: user.email,
      subject: "Your Mtaani verification code",
      html: `
        <h2>Mtaani Verification</h2>
        <p>Your verification code is:</p>
        <h1>${otp}</h1>
        <p>This code expires in 5 minutes.</p>
      `,
    });

    // ❌ only fail if provider explicitly errored
    if (!emailResult || emailResult.accepted !== true) {
      throw new Error("Email not accepted by provider");
    }

    // ✅ persist OTP AFTER acceptance
    user.emailOtpHash = otpHash;
    user.emailOtpExpiresAt = expiresAt;
    user.emailOtpLastSentAt = new Date();
    user.emailOtpMessageId = emailResult.messageId ?? null;

    await user.save();

    return res.json({
      message: "Verification email sent",
    });
  } catch (err) {
    console.error("Send email OTP error:", err);

    return res.status(500).json({
      message: "Failed to send verification email. Please try again.",
    });
  }
};

/* ---------------- VERIFY EMAIL OTP ---------------- */
exports.verifyEmailOtp = async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user.id);

    if (!code) {
      return res.status(400).json({ message: "Code is required" });
    }

    if (!user || !user.emailOtpHash) {
      return res.status(400).json({ message: "No verification in progress" });
    }

    if (!user.emailOtpExpiresAt || user.emailOtpExpiresAt < Date.now()) {
      return res.status(400).json({ message: "Code expired" });
    }

    if (hashOtp(code) !== user.emailOtpHash) {
      return res.status(400).json({ message: "Invalid code" });
    }

    // ✅ verified (single source of truth)
    user.emailVerified = true;
    user.verified = true;

    // 🧹 cleanup
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpLastSentAt = null;
    user.emailOtpMessageId = null;

    await user.save();

    return res.json({
      message: "Email verified successfully",
      user,
    });
  } catch (err) {
    console.error("Verify email OTP error:", err);
    return res.status(500).json({ message: "Verification failed" });
  }
};
