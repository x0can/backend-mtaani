const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { User, Product, Order, ProductCategory } = require('../db');
const { generateToken, hashPassword, authMiddleware, adminOnly } = require('../auth');

/* ---- Health ---- */
router.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ---- Auth ---- */
router.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, isAdmin } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields' });

        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ message: 'Email already in use' });

        const passwordHash = await hashPassword(password);
        const user = await User.create({ name, email, passwordHash, isAdmin });

        const token = generateToken(user);
        res.status(201).json({
            token,
            user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin }
        });
    } catch (err) {
        res.status(500).json({ message: 'Registration failed', error: err.message });
    }
});

router.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Missing fields' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ message: 'Invalid credentials' });

        const token = generateToken(user);
        res.json({
            token,
            user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin }
        });
    } catch (err) {
        res.status(500).json({ message: 'Login failed', error: err.message });
    }
});

/* ---- User Profile ---- */
router.get('/api/me', authMiddleware, async (req, res) => {
    res.json(req.user);
});

router.put('/api/me', authMiddleware, async (req, res) => {
    try {
        const updatable = ['name'];
        updatable.forEach(k => { if (req.body[k] !== undefined) req.user[k] = req.body[k]; });
        await req.user.save();
        res.json(req.user);
    } catch (err) {
        res.status(400).json({ message: 'Profile update failed', error: err.message });
    }
});

/* ---- Products ---- */
router.get('/api/products', async (req, res) => {
    try {
        const { q, limit = 20, page = 1 } = req.query;
        const filter = q ? { $text: { $search: q } } : {};

        const products = await Product.find(filter)
            .populate('category') // populate category field
            .skip((page - 1) * limit)
            .limit(Number(limit));

        res.json(products);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch products', error: err.message });
    }
});


router.get('/api/products/:id', async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
});

/* Admin Product Management */
router.post('/api/products', authMiddleware, adminOnly, async (req, res) => {
    try {
        const product = await Product.create(req.body);
        res.status(201).json(product);
    } catch (err) {
        res.status(400).json({ message: 'Invalid product data', error: err.message });
    }
});

router.put('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!product) return res.status(404).json({ message: 'Product not found' });
        res.json(product);
    } catch (err) {
        res.status(400).json({ message: 'Update failed', error: err.message });
    }
});

router.delete('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Deleted' });
});

/* ---- Orders ---- */
router.post('/api/orders', authMiddleware, async (req, res) => {
    try {
        const { items = [], shippingAddress = {} } = req.body;
        if (!items.length) return res.status(400).json({ message: 'No items' });

        const productIds = items.map(i => i.product);
        const products = await Product.find({ _id: { $in: productIds } });
        const prodMap = {};
        products.forEach(p => prodMap[p._id] = p);

        let total = 0;
        const orderItems = items.map(i => {
            const p = prodMap[i.product];
            if (!p) throw new Error(`Product ${i.product} not found`);
            const qty = Math.max(1, Number(i.quantity) || 1);
            total += p.price * qty;
            return { product: p._id, quantity: qty, priceAtPurchase: p.price };
        });

        const order = await Order.create({
            user: req.user._id,
            items: orderItems,
            total,
            shippingAddress,
        });

        res.status(201).json(order);
    } catch (err) {
        res.status(400).json({ message: 'Order creation failed', error: err.message });
    }
});

router.get('/api/orders', authMiddleware, async (req, res) => {
    const query = req.user.isAdmin ? {} : { user: req.user._id };
    const orders = await Order.find(query).populate('items.product').sort('-createdAt');
    res.json(orders);
});

/* ---- Categories (Admin) ---- */
router.get('/api/categories', async (req, res) => {
    const categories = await ProductCategory.find();
    res.json(categories);
});

router.post('/api/categories', authMiddleware, adminOnly, async (req, res) => {
    try {
        const category = await ProductCategory.create(req.body);
        res.status(201).json(category);
    } catch (err) {
        res.status(400).json({ message: 'Invalid category data', error: err.message });
    }
});

router.put('/api/categories/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const category = await ProductCategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!category) return res.status(404).json({ message: 'Category not found' });
        res.json(category);
    } catch (err) {
        res.status(400).json({ message: 'Update failed', error: err.message });
    }
});

router.delete('/api/categories/:id', authMiddleware, adminOnly, async (req, res) => {
    const category = await ProductCategory.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Deleted' });
});

/* ---- Global Error Handler ---- */
router.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

module.exports = router;
