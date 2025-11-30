const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../db'); // ✅ Import User

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

/* ---- Helpers ---- */
function generateToken(user) {
    return jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
}

async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
}

/* ---- Auth Middleware ---- */
async function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });

    const token = auth.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(payload.id).select('-passwordHash');
        if (!user) return res.status(401).json({ message: 'User not found' });

        req.user = user; // attach user
        next();
    } catch (err) {
        console.error('Auth error:', err); // log actual error
        return res.status(401).json({ message: 'Invalid token' });
    }
}

/* ---- Admin Only Middleware ---- */
function adminOnly(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ message: 'Forbidden - admin only' });
    next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: `Forbidden - ${role} only` });
    }
    next();
  };
}

module.exports = {
  generateToken,
  hashPassword,
  authMiddleware,
  adminOnly,
  requireRole, // NEW
};

