/**
 * Password strength rules:
 * - min 8 characters
 * - at least 1 uppercase letter
 * - at least 1 lowercase letter
 * - at least 1 number
 * - at least 1 special character
 */
module.exports = function passwordStrength(req, res, next) {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      message: "Password is required",
    });
  }

  const errors = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      message: "Weak password",
      errors,
    });
  }

  next();
};
