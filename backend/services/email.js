const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

exports.sendEmail = async ({ to, subject, html }) => {
  const { data, error } = await resend.emails.send({
    from: "Mtaani <no-reply@mtaani.co.ke>", // or resend.dev for testing
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  });

  if (error) {
    console.error("❌ Resend error:", error);
    throw new Error(error.message || "Email send failed");
  }

  // ✅ Accepted by Resend
  console.log("📧 Email accepted:", data);

  return {
    accepted: true,
    messageId: data?.id ?? null, // may be undefined, that's OK
    raw: data,
  };
};
