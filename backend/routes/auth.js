// routes/authRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { User } = require("../db");
const { generateToken, hashPassword, authMiddleware } = require("../auth");

/***********************************************************************
 *  AUTH — REGISTER & LOGIN
 ***********************************************************************/
router.post("/api/auth/register", async (req, res) => {
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
        id: fullUser._id,
        name: fullUser.name,
        email: fullUser.email,
        phone: fullUser.phone,
        role: fullUser.role,
        verified: fullUser.verified,
        image: fullUser.image || null, // ⭐ IMPORTANT
      },
    });
  } catch (err) {
    console.error("Registration failed:", err);
    res.status(500).json({ message: "Registration failed" });
  }
});

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
        id: fullUser._id,
        name: fullUser.name,
        email: fullUser.email,
        phone: fullUser.phone,
        role: fullUser.role,
        verified: fullUser.verified,
        image: fullUser.image || null, // ⭐ IMPORTANT
      },
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/***********************************************************************
 *  USER PROFILE
 ***********************************************************************/
router.get("/api/me", authMiddleware, async (req, res) => {
  const fullUser = await User.findById(req.user._id).select("-passwordHash");
  res.json({
    id: fullUser._id,
    name: fullUser.name,
    email: fullUser.email,
    phone: fullUser.phone,
    role: fullUser.role,
    verified: fullUser.verified,
    image: fullUser.image || null, // ⭐ CRITICAL
  });
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

module.exports = router;
