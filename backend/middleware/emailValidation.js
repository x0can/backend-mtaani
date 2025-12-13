const dns = require("dns").promises;

/**
 * Disposable / fake email providers (extend as needed)
 */
const BLOCKED_DOMAINS = [
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
  "yopmail.com",
  "fakeinbox.com",
];

/**
 * RFC-ish email regex (safe, not insane)
 */
const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function emailValidation(req, res, next) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  /* -----------------------------
     FORMAT CHECK
  ----------------------------- */
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      message: "Invalid email format",
    });
  }

  const domain = normalizedEmail.split("@")[1];

  /* -----------------------------
     BLOCK DISPOSABLE EMAILS
  ----------------------------- */
  if (BLOCKED_DOMAINS.includes(domain)) {
    return res.status(400).json({
      message: "Disposable email addresses are not allowed",
    });
  }

  /* -----------------------------
     DNS MX CHECK (REAL MAIL SERVER)
  ----------------------------- */
  try {
    const mxRecords = await dns.resolveMx(domain);

    if (!mxRecords || mxRecords.length === 0) {
      return res.status(400).json({
        message: "Email domain cannot receive mail",
      });
    }
  } catch (err) {
    return res.status(400).json({
      message: "Email domain does not exist",
    });
  }

  // overwrite with normalized version
  req.body.email = normalizedEmail;

  next();
};
