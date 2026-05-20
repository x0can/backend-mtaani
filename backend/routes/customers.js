const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { WalkInCustomer, POSSale } = require('../db')

// POST /api/customers
router.post('/api/customers', authMiddleware, async (req, res) => {
  try {
    const { name, phone, email } = req.body

    if (!name && !phone) {
      return res.status(400).json({ error: 'At least a name or phone number is required' })
    }

    // Check for existing customer by phone
    if (phone) {
      const existing = await WalkInCustomer.findOne({ phone })
      if (existing) {
        return res.status(409).json({ error: 'Customer with this phone number already exists', customer: existing })
      }
    }

    const customer = await WalkInCustomer.create({ name, phone, email })

    return res.status(201).json({ success: true, customer })
  } catch (err) {
    console.error('POST /api/customers error:', err)
    return res.status(500).json({ error: 'Failed to create customer' })
  }
})

// GET /api/customers
router.get('/api/customers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query
    const filter = {}

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ]
    }

    const skip = (Number(page) - 1) * Number(limit)

    const [customers, total] = await Promise.all([
      WalkInCustomer.find(filter)
        .sort({ totalSpent: -1 })
        .skip(skip)
        .limit(Number(limit)),
      WalkInCustomer.countDocuments(filter),
    ])

    return res.json({ success: true, customers, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/customers error:', err)
    return res.status(500).json({ error: 'Failed to fetch customers' })
  }
})

// GET /api/customers/search — quick lookup for cashier POS
router.get('/api/customers/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query

    if (!q || q.trim().length < 1) {
      return res.json({ success: true, customers: [] })
    }

    const customers = await WalkInCustomer.find({
      $or: [
        { phone: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ],
    }).limit(5)

    return res.json({ success: true, customers })
  } catch (err) {
    console.error('GET /api/customers/search error:', err)
    return res.status(500).json({ error: 'Failed to search customers' })
  }
})

// PUT /api/customers/:id
router.put('/api/customers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, phone, email } = req.body

    const customer = await WalkInCustomer.findByIdAndUpdate(
      req.params.id,
      { $set: { name, phone, email } },
      { new: true, runValidators: true }
    )

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    return res.json({ success: true, customer })
  } catch (err) {
    console.error('PUT /api/customers/:id error:', err)
    return res.status(500).json({ error: 'Failed to update customer' })
  }
})

// POST /api/customers/:id/loyalty/add
router.post('/api/customers/:id/loyalty/add', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { points, reason } = req.body

    if (!points || Number(points) <= 0) {
      return res.status(400).json({ error: 'points must be a positive number' })
    }

    const customer = await WalkInCustomer.findByIdAndUpdate(
      req.params.id,
      { $inc: { loyaltyPoints: Number(points) } },
      { new: true }
    )

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    return res.json({ success: true, customer, reason })
  } catch (err) {
    console.error('POST /api/customers/:id/loyalty/add error:', err)
    return res.status(500).json({ error: 'Failed to add loyalty points' })
  }
})

// POST /api/customers/:id/loyalty/redeem
router.post('/api/customers/:id/loyalty/redeem', authMiddleware, async (req, res) => {
  try {
    const { points } = req.body

    if (!points || Number(points) <= 0) {
      return res.status(400).json({ error: 'points must be a positive number' })
    }

    const customer = await WalkInCustomer.findById(req.params.id)
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    if (customer.loyaltyPoints < Number(points)) {
      return res.status(400).json({
        error: `Insufficient loyalty points. Customer has ${customer.loyaltyPoints} points`,
      })
    }

    customer.loyaltyPoints -= Number(points)
    await customer.save()

    const pointsValue = Number(points) * 0.5 // 1 point = KES 0.50

    return res.json({ success: true, customer, pointsValue })
  } catch (err) {
    console.error('POST /api/customers/:id/loyalty/redeem error:', err)
    return res.status(500).json({ error: 'Failed to redeem loyalty points' })
  }
})

// GET /api/customers/:id/history
router.get('/api/customers/:id/history', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const customer = await WalkInCustomer.findById(req.params.id)
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    const [sales, total] = await Promise.all([
      POSSale.find({ customer: req.params.id })
        .populate('cashier', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      POSSale.countDocuments({ customer: req.params.id }),
    ])

    return res.json({ success: true, customer, sales, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/customers/:id/history error:', err)
    return res.status(500).json({ error: 'Failed to fetch customer history' })
  }
})

module.exports = router
