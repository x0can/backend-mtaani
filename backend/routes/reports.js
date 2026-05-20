const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { POSSale, Order, InventoryTransaction } = require('../db')

// Helpers
function dayBounds(dateStr) {
  const start = dateStr ? new Date(dateStr) : new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

// GET /api/reports/sales/daily
router.get('/api/reports/sales/daily', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { date } = req.query
    const { start, end } = dayBounds(date)

    // POS sales aggregation
    const [posAgg, posHourAgg, posTopItems, onlineOrders] = await Promise.all([
      POSSale.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'completed' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$total' },
            totalTransactions: { $sum: 1 },
            totalCash: {
              $sum: {
                $reduce: {
                  input: '$payments',
                  initialValue: 0,
                  in: {
                    $cond: [{ $eq: ['$$this.method', 'cash'] }, { $add: ['$$value', '$$this.amount'] }, '$$value'],
                  },
                },
              },
            },
            totalMpesa: {
              $sum: {
                $reduce: {
                  input: '$payments',
                  initialValue: 0,
                  in: {
                    $cond: [{ $eq: ['$$this.method', 'mpesa'] }, { $add: ['$$value', '$$this.amount'] }, '$$value'],
                  },
                },
              },
            },
            totalCard: {
              $sum: {
                $reduce: {
                  input: '$payments',
                  initialValue: 0,
                  in: {
                    $cond: [{ $eq: ['$$this.method', 'card'] }, { $add: ['$$value', '$$this.amount'] }, '$$value'],
                  },
                },
              },
            },
          },
        },
      ]),

      POSSale.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'completed' } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            revenue: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { hour: '$_id', revenue: 1, count: 1, _id: 0 } },
      ]),

      POSSale.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'completed' } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            title: { $first: '$items.title' },
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 10 },
      ]),

      Order.find({
        createdAt: { $gte: start, $lte: end },
        status: { $ne: 'cancelled' },
      }).select('total status'),
    ])

    const pos = posAgg[0] || { totalRevenue: 0, totalTransactions: 0, totalCash: 0, totalMpesa: 0, totalCard: 0 }
    const onlineRevenue = onlineOrders.reduce((s, o) => s + (o.total || 0), 0)
    const onlineTransactions = onlineOrders.length

    const avgOrderValue =
      pos.totalTransactions + onlineTransactions > 0
        ? (pos.totalRevenue + onlineRevenue) / (pos.totalTransactions + onlineTransactions)
        : 0

    return res.json({
      success: true,
      date: start.toISOString().split('T')[0],
      pos: {
        totalRevenue: pos.totalRevenue,
        totalTransactions: pos.totalTransactions,
        byPaymentMethod: {
          cash: pos.totalCash,
          mpesa: pos.totalMpesa,
          card: pos.totalCard,
        },
      },
      online: {
        totalRevenue: onlineRevenue,
        totalTransactions: onlineTransactions,
      },
      combined: {
        totalRevenue: pos.totalRevenue + onlineRevenue,
        totalTransactions: pos.totalTransactions + onlineTransactions,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      },
      byHour: posHourAgg,
      topItems: posTopItems,
    })
  } catch (err) {
    console.error('GET /api/reports/sales/daily error:', err)
    return res.status(500).json({ error: 'Failed to generate daily sales report' })
  }
})

// GET /api/reports/sales/range
router.get('/api/reports/sales/range', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' })
    }

    const start = new Date(startDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    const [posAgg, onlineAgg] = await Promise.all([
      POSSale.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'completed' } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
            },
            posRevenue: { $sum: '$total' },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),

      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
            },
            onlineRevenue: { $sum: '$total' },
            onlineTransactions: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),
    ])

    // Merge by date key
    const onlineMap = {}
    for (const row of onlineAgg) {
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}-${String(row._id.day).padStart(2, '0')}`
      onlineMap[key] = row
    }

    const days = posAgg.map((row) => {
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}-${String(row._id.day).padStart(2, '0')}`
      const online = onlineMap[key] || { onlineRevenue: 0, onlineTransactions: 0 }
      return {
        date: key,
        posRevenue: row.posRevenue,
        onlineRevenue: online.onlineRevenue,
        revenue: row.posRevenue + online.onlineRevenue,
        transactions: row.transactions + (online.onlineTransactions || 0),
      }
    })

    return res.json({ success: true, days })
  } catch (err) {
    console.error('GET /api/reports/sales/range error:', err)
    return res.status(500).json({ error: 'Failed to generate range report' })
  }
})

// GET /api/reports/products/top-selling
router.get('/api/reports/products/top-selling', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate, limit = 20 } = req.query
    const matchFilter = {}

    if (startDate || endDate) {
      matchFilter.createdAt = {}
      if (startDate) matchFilter.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const ed = new Date(endDate)
        ed.setHours(23, 59, 59, 999)
        matchFilter.createdAt.$lte = ed
      }
    }

    const [posItems, onlineItems] = await Promise.all([
      POSSale.aggregate([
        { $match: { ...matchFilter, status: 'completed' } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            title: { $first: '$items.title' },
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: '$items.lineTotal' },
          },
        },
      ]),

      Order.aggregate([
        { $match: { ...matchFilter, status: { $ne: 'cancelled' } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } },
          },
        },
      ]),
    ])

    // Merge both sources
    const combined = {}

    for (const item of posItems) {
      const key = item._id ? item._id.toString() : 'unknown'
      combined[key] = {
        productId: item._id,
        title: item.title || '',
        totalQuantity: item.totalQuantity,
        totalRevenue: item.totalRevenue,
      }
    }

    for (const item of onlineItems) {
      const key = item._id ? item._id.toString() : 'unknown'
      if (combined[key]) {
        combined[key].totalQuantity += item.totalQuantity
        combined[key].totalRevenue += item.totalRevenue
      } else {
        combined[key] = {
          productId: item._id,
          title: '',
          totalQuantity: item.totalQuantity,
          totalRevenue: item.totalRevenue,
        }
      }
    }

    const sorted = Object.values(combined)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, Number(limit))

    return res.json({ success: true, products: sorted })
  } catch (err) {
    console.error('GET /api/reports/products/top-selling error:', err)
    return res.status(500).json({ error: 'Failed to generate top-selling report' })
  }
})

// GET /api/reports/inventory/movement
router.get('/api/reports/inventory/movement', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { productId, startDate, endDate, type, page = 1, limit = 50 } = req.query
    const filter = {}

    if (productId) filter.product = productId
    if (type) filter.type = type
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const ed = new Date(endDate)
        ed.setHours(23, 59, 59, 999)
        filter.createdAt.$lte = ed
      }
    }

    const skip = (Number(page) - 1) * Number(limit)

    const [transactions, total] = await Promise.all([
      InventoryTransaction.find(filter)
        .populate('product', 'title sku barcode')
        .populate('performedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InventoryTransaction.countDocuments(filter),
    ])

    return res.json({ success: true, transactions, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/reports/inventory/movement error:', err)
    return res.status(500).json({ error: 'Failed to fetch inventory movement' })
  }
})

// GET /api/reports/cashier/performance
router.get('/api/reports/cashier/performance', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const matchFilter = { status: 'completed' }

    if (startDate || endDate) {
      matchFilter.createdAt = {}
      if (startDate) matchFilter.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const ed = new Date(endDate)
        ed.setHours(23, 59, 59, 999)
        matchFilter.createdAt.$lte = ed
      }
    }

    const performance = await POSSale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$cashier',
          totalSales: { $sum: '$total' },
          transactionCount: { $sum: 1 },
          avgSale: { $avg: '$total' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'cashier',
        },
      },
      { $unwind: { path: '$cashier', preserveNullAndEmpty: true } },
      {
        $project: {
          cashier: { name: '$cashier.name', email: '$cashier.email' },
          totalSales: 1,
          transactionCount: 1,
          avgSale: { $round: ['$avgSale', 2] },
        },
      },
      { $sort: { totalSales: -1 } },
    ])

    return res.json({ success: true, performance })
  } catch (err) {
    console.error('GET /api/reports/cashier/performance error:', err)
    return res.status(500).json({ error: 'Failed to generate cashier performance report' })
  }
})

// GET /api/reports/revenue/summary
router.get('/api/reports/revenue/summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { period = 'day' } = req.query

    const now = new Date()
    let currentStart, previousStart, previousEnd

    if (period === 'day') {
      currentStart = new Date(now); currentStart.setHours(0, 0, 0, 0)
      previousEnd = new Date(currentStart); previousEnd.setMilliseconds(-1)
      previousStart = new Date(previousEnd); previousStart.setHours(0, 0, 0, 0)
    } else if (period === 'week') {
      const day = now.getDay()
      currentStart = new Date(now); currentStart.setDate(now.getDate() - day); currentStart.setHours(0, 0, 0, 0)
      previousEnd = new Date(currentStart); previousEnd.setMilliseconds(-1)
      previousStart = new Date(previousEnd); previousStart.setDate(previousEnd.getDate() - 6); previousStart.setHours(0, 0, 0, 0)
    } else if (period === 'month') {
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      previousEnd = new Date(currentStart); previousEnd.setMilliseconds(-1)
      previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), 1)
    } else if (period === 'year') {
      currentStart = new Date(now.getFullYear(), 0, 1)
      previousEnd = new Date(currentStart); previousEnd.setMilliseconds(-1)
      previousStart = new Date(previousEnd.getFullYear(), 0, 1)
    } else {
      return res.status(400).json({ error: 'period must be one of: day, week, month, year' })
    }

    const currentEnd = now

    const [currentPos, previousPos, currentOnline, previousOnline] = await Promise.all([
      POSSale.aggregate([
        { $match: { createdAt: { $gte: currentStart, $lte: currentEnd }, status: 'completed' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
      POSSale.aggregate([
        { $match: { createdAt: { $gte: previousStart, $lte: previousEnd }, status: 'completed' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: currentStart, $lte: currentEnd }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: previousStart, $lte: previousEnd }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
    ])

    const posRevenue = (currentPos[0] || {}).revenue || 0
    const onlineRevenue = (currentOnline[0] || {}).revenue || 0
    const totalRevenue = posRevenue + onlineRevenue
    const totalOrders = ((currentPos[0] || {}).orders || 0) + ((currentOnline[0] || {}).orders || 0)

    const prevPosRevenue = (previousPos[0] || {}).revenue || 0
    const prevOnlineRevenue = (previousOnline[0] || {}).revenue || 0
    const prevTotalRevenue = prevPosRevenue + prevOnlineRevenue

    const growth = prevTotalRevenue > 0
      ? Math.round(((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 10000) / 100
      : null

    return res.json({
      success: true,
      period,
      totalRevenue,
      posRevenue,
      onlineRevenue,
      totalOrders,
      growthPercent: growth,
      previousPeriodRevenue: prevTotalRevenue,
    })
  } catch (err) {
    console.error('GET /api/reports/revenue/summary error:', err)
    return res.status(500).json({ error: 'Failed to generate revenue summary' })
  }
})

module.exports = router
