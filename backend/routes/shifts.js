const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { Shift, POSSale } = require('../db')

// POST /api/shifts/open
router.post('/api/shifts/open', authMiddleware, async (req, res) => {
  try {
    const { openingFloat = 0 } = req.body

    const existing = await Shift.findOne({ cashier: req.user._id, status: 'open' })
    if (existing) {
      return res.status(400).json({ error: 'You already have an open shift', shift: existing })
    }

    const shift = await Shift.create({
      cashier: req.user._id,
      openingFloat: Number(openingFloat),
      status: 'open',
    })

    return res.status(201).json({ success: true, shift })
  } catch (err) {
    console.error('POST /api/shifts/open error:', err)
    return res.status(500).json({ error: 'Failed to open shift' })
  }
})

// GET /api/shifts/current
router.get('/api/shifts/current', authMiddleware, async (req, res) => {
  try {
    const shift = await Shift.findOne({ cashier: req.user._id, status: 'open' })
      .populate('cashier', 'name email')

    if (!shift) {
      return res.status(404).json({ error: 'No open shift found' })
    }

    return res.json({ success: true, shift })
  } catch (err) {
    console.error('GET /api/shifts/current error:', err)
    return res.status(500).json({ error: 'Failed to fetch current shift' })
  }
})

// PUT /api/shifts/:id/close
router.put('/api/shifts/:id/close', authMiddleware, async (req, res) => {
  try {
    const { closingFloat } = req.body
    const shift = await Shift.findById(req.params.id)

    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' })
    }

    const isOwner = shift.cashier.toString() === req.user._id.toString()
    if (!isOwner && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorised to close this shift' })
    }

    if (shift.status === 'closed') {
      return res.status(400).json({ error: 'Shift is already closed' })
    }

    // Calculate summary from POSSale records in this shift
    const sales = await POSSale.find({ shift: shift._id, status: 'completed' })

    let totalSales = 0
    let totalCash = 0
    let totalMpesa = 0
    let totalCard = 0

    for (const sale of sales) {
      totalSales += sale.total
      for (const payment of sale.payments) {
        if (payment.method === 'cash') totalCash += payment.amount
        else if (payment.method === 'mpesa') totalMpesa += payment.amount
        else if (payment.method === 'card') totalCard += payment.amount
      }
    }

    // expectedFloat = openingFloat + totalCash - sum of cashDrops
    const cashDropsTotal = shift.cashDrops.reduce((sum, d) => sum + (d.amount || 0), 0)
    const expectedFloat = shift.openingFloat + totalCash - cashDropsTotal

    shift.status = 'closed'
    shift.closedAt = new Date()
    shift.closingFloat = closingFloat != null ? Number(closingFloat) : null
    shift.expectedFloat = expectedFloat
    shift.summary = {
      totalSales,
      totalCash,
      totalMpesa,
      totalCard,
      transactionCount: sales.length,
    }

    await shift.save()

    return res.json({ success: true, shift })
  } catch (err) {
    console.error('PUT /api/shifts/:id/close error:', err)
    return res.status(500).json({ error: 'Failed to close shift' })
  }
})

// POST /api/shifts/:id/cash-drop
router.post('/api/shifts/:id/cash-drop', authMiddleware, async (req, res) => {
  try {
    const { amount, note } = req.body

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' })
    }

    const shift = await Shift.findById(req.params.id)
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' })
    }
    if (shift.status === 'closed') {
      return res.status(400).json({ error: 'Cannot add cash drop to a closed shift' })
    }

    shift.cashDrops.push({ amount: Number(amount), note: note || '' })
    await shift.save()

    return res.json({ success: true, shift })
  } catch (err) {
    console.error('POST /api/shifts/:id/cash-drop error:', err)
    return res.status(500).json({ error: 'Failed to record cash drop' })
  }
})

// GET /api/shifts
router.get('/api/shifts', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { cashierId, date, page = 1, limit = 20 } = req.query
    const filter = {}

    if (cashierId) filter.cashier = cashierId

    if (date) {
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      filter.openedAt = { $gte: start, $lte: end }
    }

    const skip = (Number(page) - 1) * Number(limit)

    const [shifts, total] = await Promise.all([
      Shift.find(filter)
        .populate('cashier', 'name email')
        .sort({ openedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Shift.countDocuments(filter),
    ])

    return res.json({ success: true, shifts, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/shifts error:', err)
    return res.status(500).json({ error: 'Failed to fetch shifts' })
  }
})

module.exports = router
