// routes/authRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { User } = require("../db");
const { generateToken, hashPassword, authMiddleware } = require("../auth");
const passwordStrength = require("../middleware/passwordStrength");
const emailValidation = require("../middleware/emailValidation");
const kenyanPhoneCheck = require("../middleware/kenyanPhoneCheck");
const { getCache, setCache, delCache } = require("../services/cache");
const {
  sendPhoneOtp,
  verifyPhoneOtp,
} = require("../controllers/phoneVerification");
const { sendEmailOtp, verifyEmailOtp } = require("../controllers/emailVerification");

/***********************************************************************
 *  AUTH — REGISTER & LOGIN
 ***********************************************************************/
router.post(
  "/api/auth/register",
  passwordStrength,
  emailValidation,
  kenyanPhoneCheck,
  async (req, res) => {
    try {
      const { name, email, password, phone, role } = req.body;

      if (!name || !email || !password || !phone) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const exists = await User.findOne({ email });
      if (exists) {
        return res.status(400).json({ message: "Email already in use" });
      }

      const passwordHash = await hashPassword(password);

      const user = await User.create({
        name,
        email,
        phone,
        passwordHash,
        isAdmin: false,
        role: role === "rider" ? "rider" : "customer",
      });

      const token = generateToken(user);

      const fullUser = await User.findById(user._id).select("-passwordHash");

      res.json({
        token,
        user: {
          _id: fullUser._id,
          name: fullUser.name,
          email: fullUser.email,
          phone: fullUser.phone,
          role: fullUser.role,
          verified: fullUser.verified,
          image: fullUser.image || null,
        },
      });
    } catch (err) {
      console.error("Registration failed:", err);
      res.status(500).json({ message: "Registration failed" });
    }
  }
);

router.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

    const token = generateToken(user);

    const fullUser = await User.findById(user._id).select("-passwordHash");

    res.json({
      token,
      user: {
        _id: fullUser._id,
        name: fullUser.name,
        email: fullUser.email,
        phone: fullUser.phone,
        role: fullUser.role,
        verified: fullUser.verified,
        image: fullUser.image || null, // ⭐ IMPORTANT
        isAdmin: fullUser.isAdmin, // ⭐ IMPORTANT
      },
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

router.post("/api/auth/resend-code", authMiddleware, sendPhoneOtp);
router.post("/api/auth/verify-phone", authMiddleware, verifyPhoneOtp);

router.post("/api/auth/send-email-otp", authMiddleware, sendEmailOtp);
router.post("/api/auth/verify-email-otp", authMiddleware, verifyEmailOtp);


/***********************************************************************
 *  USER PROFILE
 ***********************************************************************/

router.get("/api/me", authMiddleware, async (req, res) => {
  const cacheKey = `auth:${req.user._id}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findById(req.user._id).select("-passwordHash");

  const payload = {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    verified: user.verified,
    image: user.image || null,
  };

  await setCache(cacheKey, payload, 300); // 5 min
  res.json(payload);
});

router.put("/api/me", authMiddleware, async (req, res) => {
  try {
    if (req.body.name) req.user.name = req.body.name;
    if (typeof req.body.phone !== "undefined") req.user.phone = req.body.phone;

    await req.user.save();
    res.json(req.user);
  } catch (err) {
    console.error("Profile update failed:", err);
    res.status(400).json({ message: "Profile update failed" });
  }
});

/***********************************************************************
 *  GET SINGLE USER (PUBLIC FOR RIDER USE)
 ***********************************************************************/
router.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-passwordHash");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (err) {
    console.error("Fetch user error:", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

module.exports = router;
