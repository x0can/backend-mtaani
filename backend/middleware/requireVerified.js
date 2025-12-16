const { User } = require("../db");

module.exports = async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user || !user.verified) {
    return res.status(403).json({
      message: "Email verification required",
    });
  }

  next();
};
