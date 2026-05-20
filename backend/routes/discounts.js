const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { Discount } = require('../db')

// POST /api/discounts
router.post('/api/discounts', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      name,
      code,
      type,
      value,
      minOrderAmount,
      maxUses,
      applicableProducts,
      applicableCategories,
      startAt,
      endAt,
    } = req.body

    if (!name || !type || value == null) {
      return res.status(400).json({ error: 'name, type, and value are required' })
    }

    const discount = await Discount.create({
      name,
      code: code ? code.toUpperCase() : undefined,
      type,
      value,
      minOrderAmount: minOrderAmount || 0,
      maxUses: maxUses || undefined,
      applicableProducts: applicableProducts || [],
      applicableCategories: applicableCategories || [],
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
      createdBy: req.user._id,
    })

    return res.status(201).json({ success: true, discount })
  } catch (err) {
    console.error('POST /api/discounts error:', err)
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Discount code already exists' })
    }
    return res.status(500).json({ error: 'Failed to create discount' })
  }
})

// GET /api/discounts
router.get('/api/discounts', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { active, type } = req.query
    const filter = {}

    if (active !== undefined) filter.active = active === 'true'
    if (type) filter.type = type

    const discounts = await Discount.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })

    return res.json({ success: true, discounts })
  } catch (err) {
    console.error('GET /api/discounts error:', err)
    return res.status(500).json({ error: 'Failed to fetch discounts' })
  }
})

// PUT /api/discounts/:id
router.put('/api/discounts/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Ensure code is uppercased if provided
    if (req.body.code) {
      req.body.code = req.body.code.toUpperCase()
    }

    const discount = await Discount.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )

    if (!discount) {
      return res.status(404).json({ error: 'Discount not found' })
    }

    return res.json({ success: true, discount })
  } catch (err) {
    console.error('PUT /api/discounts/:id error:', err)
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Discount code already exists' })
    }
    return res.status(500).json({ error: 'Failed to update discount' })
  }
})

// DELETE /api/discounts/:id — soft delete
router.delete('/api/discounts/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const discount = await Discount.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    )

    if (!discount) {
      return res.status(404).json({ error: 'Discount not found' })
    }

    return res.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/discounts/:id error:', err)
    return res.status(500).json({ error: 'Failed to deactivate discount' })
  }
})

// POST /api/discounts/validate
router.post('/api/discounts/validate', authMiddleware, async (req, res) => {
  try {
    const { code, cartTotal, items = [] } = req.body

    if (!code) {
      return res.json({ valid: false, reason: 'No discount code provided' })
    }

    const now = new Date()
    const discount = await Discount.findOne({ code: code.toUpperCase() })

    if (!discount) {
      return res.json({ valid: false, reason: 'Invalid discount code' })
    }
    if (!discount.active) {
      return res.json({ valid: false, reason: 'Discount is no longer active' })
    }
    if (discount.startAt && now < discount.startAt) {
      return res.json({ valid: false, reason: 'Discount is not yet active' })
    }
    if (discount.endAt && now > discount.endAt) {
      return res.json({ valid: false, reason: 'Discount has expired' })
    }
    if (cartTotal < discount.minOrderAmount) {
      return res.json({
        valid: false,
        reason: `Minimum order amount of KES ${discount.minOrderAmount} not met`,
      })
    }
    if (discount.maxUses != null && discount.usedCount >= discount.maxUses) {
      return res.json({ valid: false, reason: 'Discount usage limit has been reached' })
    }

    let discountAmount = 0
    if (discount.type === 'percentage') {
      discountAmount = (cartTotal * discount.value) / 100
    } else if (discount.type === 'fixed') {
      discountAmount = Math.min(discount.value, cartTotal)
    } else if (discount.type === 'bogo') {
      // BOGO: free item of equal or lesser value — return amount of the cheapest eligible item
      // Simplified: return 0 and let the POS handle it
      discountAmount = 0
    }

    return res.json({ valid: true, discount, discountAmount })
  } catch (err) {
    console.error('POST /api/discounts/validate error:', err)
    return res.status(500).json({ error: 'Failed to validate discount' })
  }
})

module.exports = router
