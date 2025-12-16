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

    if (user.verified) {
      return res.json({ message: "Email already verified" });
    }

    // rate limit (30s)
    if (
      user.emailOtpLastSentAt &&
      Date.now() - user.emailOtpLastSentAt.getTime() < 30_000
    ) {
      return res.status(429).json({
        message: "Please wait before requesting another code",
      });
    }

    const otp = generateOtp();

    user.emailOtpHash = hashOtp(otp);
    user.emailOtpExpiresAt = Date.now() + 5 * 60 * 1000;
    user.emailOtpLastSentAt = new Date();

    await user.save();

    await sendEmail({
      to: user.email,
      subject: "Your Mtaani verification code",
      html: `
      <h2>Mtaani Verification</h2>
      <p>Your verification code is:</p>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
      `,
    });

    res.json({ message: "Verification email sent" });
  } catch (err) {
    console.error("Send email OTP error:", err);
    res.status(500).json({ message: "Failed to send verification email" });
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

    if (user.emailOtpExpiresAt < Date.now()) {
      return res.status(400).json({ message: "Code expired" });
    }

    if (hashOtp(code) !== user.emailOtpHash) {
      return res.status(400).json({ message: "Invalid code" });
    }

    user.emailVerified = true;
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpLastSentAt = null;
    user.verified = true;

    await user.save();

    res.json({ message: "Email verified successfully", user });
  } catch (err) {
    console.error("Verify email OTP error:", err);
    res.status(500).json({ message: "Verification failed" });
  }
};
