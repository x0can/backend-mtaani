const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App password
  },
});

exports.sendEmail = async ({ to, subject, html }) => {
  return transporter.sendMail({
    from: `"Mtaani" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};
