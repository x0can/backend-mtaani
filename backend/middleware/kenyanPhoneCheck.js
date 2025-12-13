/**
 * Legit Kenyan mobile prefixes (updated)
 */
const VALID_PREFIXES = [
  // Safaricom
  "070", "071", "072", "074",
  "011",

  // Airtel
  "073", "075",
  "010",

  // Telkom
  "077",

  // MVNOs
  "076", "078", "079",
];

/**
 * Accepted formats:
 *  - 07XXXXXXXX
 *  - 01XXXXXXXX
 *  - 2547XXXXXXXX
 *  - 2541XXXXXXXX
 *  - +2547XXXXXXXX
 *  - +2541XXXXXXXX
 */
const KENYAN_PHONE_REGEX =
  /^(?:\+254|254|0)(7\d{8}|1\d{8})$/;

module.exports = function kenyanPhoneCheck(req, res, next) {
  const { phone } = req.body;

  /* -----------------------------
     REQUIRED
  ----------------------------- */
  if (!phone) {
    return res.status(400).json({
      message: "Phone number is required",
    });
  }

  /* -----------------------------
     BASIC FORMAT CHECK
  ----------------------------- */
  if (!KENYAN_PHONE_REGEX.test(phone)) {
    return res.status(400).json({
      message: "Invalid Kenyan mobile phone number",
    });
  }

  /* -----------------------------
     NORMALIZE FOR VALIDATION ONLY
     (NOT STORED)
  ----------------------------- */
  let normalized = phone;

  if (phone.startsWith("+254")) normalized = "0" + phone.slice(4);
  else if (phone.startsWith("254")) normalized = "0" + phone.slice(3);

  const prefix = normalized.slice(0, 3);

  /* -----------------------------
     PREFIX VALIDATION
  ----------------------------- */
  if (!VALID_PREFIXES.includes(prefix)) {
    return res.status(400).json({
      message: "Unsupported Kenyan mobile network",
    });
  }

  /* -----------------------------
     BLOCK OBVIOUS FAKE NUMBERS
  ----------------------------- */
  if (/^(0[17])(\d)\2{7}$/.test(normalized)) {
    return res.status(400).json({
      message: "Invalid phone number",
    });
  }

  // ✅ Validation only — do not mutate req.body.phone
  next();
};
