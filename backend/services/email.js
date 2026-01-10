// services/email.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true", // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Optional: verify SMTP config on boot (call once in app start if you want)
exports.verifyEmailTransport = async () => {
  await transporter.verify();
  console.log("✅ SMTP transporter ready");
};

exports.sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.APP_EMAIL_FROM || process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      html,
      text,
    });

    console.log("📧 Email sent:", info.messageId);

    return {
      accepted: true,
      messageId: info.messageId,
      raw: info,
    };
  } catch (err) {
    console.error("❌ SMTP send error:", err);
    throw new Error(err?.message || "Email send failed");
  }
};
