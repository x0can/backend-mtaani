// routes/uploadRoutes.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();

const cloudinary = require("../cloudinary");
const { authMiddleware, adminOnly } = require("../auth");

const tempDir = path.join(__dirname, "../db", "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

router.post(
  "/api/upload",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      const uploadRes = await cloudinary.uploader.upload(req.file.path, {
        folder: "ecommerce",
      });

      fs.unlinkSync(req.file.path);
      res.json({ url: uploadRes.secure_url });
    } catch (err) {
      console.error("Upload Error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

module.exports = router;
