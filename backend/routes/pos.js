const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const {
  Product,
  Order,
  POSSale,
  Shift,
  InventoryTransaction,
  WalkInCustomer,
  Discount,
} = require('../db')

// POST /api/pos/sale
router.post('/api/pos/sale', authMiddleware, async (req, res) => {
  try {
    const { items, paymentMethod, payments = [], customerId, discountCode } = req.body

    if (!items || !items.length) {
      return res.status(400).json({ error: 'No items provided' })
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: 'paymentMethod is required' })
    }

    // 1. Find cashier's open shift
    const shift = await Shift.findOne({ cashier: req.user._id, status: 'open' })

    // 2. Validate and fetch products
    const productIds = items.map((i) => i.productId)
    const products = await Product.find({ _id: { $in: productIds } })

    if (products.length !== items.length) {
      return res.status(400).json({ error: 'One or more products not found' })
    }

    const productMap = {}
    for (const p of products) {
      productMap[p._id.toString()] = p
    }

    // 3. Build sale items and calculate subtotal
    let subtotal = 0
    const saleItems = []

    for (const item of items) {
      const product = productMap[item.productId.toString()]
      if (!product) {
        return res.status(400).json({ error: `Product ${item.productId} not found` })
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.title}` })
      }
      const lineTotal = product.price * item.quantity
      subtotal += lineTotal
      saleItems.push({
        product: product._id,
        title: product.title,
        barcode: product.barcode || '',
        quantity: item.quantity,
        unitPrice: product.price,
        discountAmount: 0,
        lineTotal,
      })
    }

    // 4. Apply discount if provided
    let discountAmount = 0
    let appliedDiscount = null

    if (discountCode) {
      const now = new Date()
      const discount = await Discount.findOne({
        code: discountCode.toUpperCase(),
        active: true,
      })

      if (!discount) {
        return res.status(400).json({ error: 'Invalid or inactive discount code' })
      }
      if (discount.startAt && now < discount.startAt) {
        return res.status(400).json({ error: 'Discount not yet active' })
      }
      if (discount.endAt && now > discount.endAt) {
        return res.status(400).json({ error: 'Discount has expired' })
      }
      if (subtotal < discount.minOrderAmount) {
        return res.status(400).json({
          error: `Minimum order amount of KES ${discount.minOrderAmount} not met`,
        })
      }
      if (discount.maxUses != null && discount.usedCount >= discount.maxUses) {
        return res.status(400).json({ error: 'Discount usage limit reached' })
      }

      if (discount.type === 'percentage') {
        discountAmount = (subtotal * discount.value) / 100
      } else if (discount.type === 'fixed') {
        discountAmount = Math.min(discount.value, subtotal)
      }
      // bogo handled externally for now

      appliedDiscount = discount
    }

    // 5. Calculate total
    const total = Math.max(0, subtotal - discountAmount)

    // 6. Validate payments sum >= total
    const paymentsTotal = payments.reduce((sum, p) => sum + (p.amount || 0), 0)
    if (payments.length > 0 && paymentsTotal < total) {
      return res.status(400).json({
        error: `Payments total (${paymentsTotal}) is less than sale total (${total})`,
      })
    }

    // 7. Calculate change (cash only / split)
    const change = Math.max(0, paymentsTotal - total)

    // 8. Generate sale number
    const saleNumber = 'POS-' + Date.now()

    // 9. Deduct stock and create inventory transactions
    for (const item of saleItems) {
      const product = productMap[item.product.toString()]
      const previousStock = product.stock

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
      })

      const newStock = Math.max(0, previousStock - item.quantity)

      await InventoryTransaction.create({
        product: item.product,
        type: 'pos_sale',
        quantity: -item.quantity,
        previousStock,
        newStock,
        reference: saleNumber,
        note: `POS sale ${saleNumber}`,
        performedBy: req.user._id,
      })
    }

    // 11. Create POSSale document
    const loyaltyPointsEarned = Math.floor(total / 100)

    const sale = await POSSale.create({
      saleNumber,
      cashier: req.user._id,
      shift: shift ? shift._id : undefined,
      customer: customerId || undefined,
      items: saleItems,
      subtotal,
      discountAmount,
      taxAmount: 0,
      total,
      payments,
      change,
      paymentMethod,
      status: 'completed',
      loyaltyPointsEarned,
    })

    // 12. Update shift summary
    if (shift) {
      const cashTotal = payments
        .filter((p) => p.method === 'cash')
        .reduce((s, p) => s + p.amount, 0)
      const mpesaTotal = payments
        .filter((p) => p.method === 'mpesa')
        .reduce((s, p) => s + p.amount, 0)
      const cardTotal = payments
        .filter((p) => p.method === 'card')
        .reduce((s, p) => s + p.amount, 0)

      await Shift.findByIdAndUpdate(shift._id, {
        $inc: {
          'summary.totalSales': total,
          'summary.totalCash': cashTotal,
          'summary.totalMpesa': mpesaTotal,
          'summary.totalCard': cardTotal,
          'summary.transactionCount': 1,
        },
      })
    }

    // 13. Update discount usedCount
    if (appliedDiscount) {
      await Discount.findByIdAndUpdate(appliedDiscount._id, {
        $inc: { usedCount: 1 },
      })
    }

    // 14. Update walk-in customer
    if (customerId) {
      await WalkInCustomer.findByIdAndUpdate(customerId, {
        $inc: {
          totalSpent: total,
          visitCount: 1,
          loyaltyPoints: loyaltyPointsEarned,
        },
        lastVisit: new Date(),
      })
    }

    return res.status(201).json({ success: true, sale })
  } catch (err) {
    console.error('POST /api/pos/sale error:', err)
    return res.status(500).json({ error: 'Failed to process sale' })
  }
})

// GET /api/pos/sales
router.get('/api/pos/sales', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { date, cashierId, page = 1, limit = 50 } = req.query
    const filter = {}

    if (date) {
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      filter.createdAt = { $gte: start, $lte: end }
    }

    if (cashierId) {
      filter.cashier = cashierId
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [sales, total] = await Promise.all([
      POSSale.find(filter)
        .populate('cashier', 'name email')
        .populate('customer', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      POSSale.countDocuments(filter),
    ])

    return res.json({ success: true, sales, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/pos/sales error:', err)
    return res.status(500).json({ error: 'Failed to fetch sales' })
  }
})

// GET /api/pos/receipt/:id
router.get('/api/pos/receipt/:id', authMiddleware, async (req, res) => {
  try {
    const sale = await POSSale.findById(req.params.id)
      .populate('cashier', 'name email')
      .populate('customer', 'name phone email')
      .populate('shift')
      .populate('items.product', 'title barcode sku images')

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' })
    }

    return res.json({ success: true, sale })
  } catch (err) {
    console.error('GET /api/pos/receipt/:id error:', err)
    return res.status(500).json({ error: 'Failed to fetch receipt' })
  }
})

// PUT /api/pos/sale/:id/void
router.put('/api/pos/sale/:id/void', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body

    if (!reason) {
      return res.status(400).json({ error: 'Void reason is required' })
    }

    const sale = await POSSale.findById(req.params.id)
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' })
    }
    if (sale.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed sales can be voided' })
    }

    // Restore stock for each item
    for (const item of sale.items) {
      const product = await Product.findById(item.product)
      const previousStock = product ? product.stock : 0

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
      })

      await InventoryTransaction.create({
        product: item.product,
        type: 'return',
        quantity: item.quantity,
        previousStock,
        newStock: previousStock + item.quantity,
        reference: sale.saleNumber,
        note: `Void of sale ${sale.saleNumber}: ${reason}`,
        performedBy: req.user._id,
      })
    }

    sale.status = 'voided'
    sale.voidReason = reason
    await sale.save()

    return res.json({ success: true, sale })
  } catch (err) {
    console.error('PUT /api/pos/sale/:id/void error:', err)
    return res.status(500).json({ error: 'Failed to void sale' })
  }
})

// POST /api/pos/sale/:id/refund
router.post('/api/pos/sale/:id/refund', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { reason, items: refundItems } = req.body

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' })
    }

    const sale = await POSSale.findById(req.params.id)
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' })
    }
    if (sale.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed sales can be refunded' })
    }

    // Determine items to refund
    const itemsToRefund = refundItems && refundItems.length
      ? sale.items.filter((si) =>
          refundItems.some((ri) => ri.itemId && ri.itemId.toString() === si._id.toString())
        ).map((si) => {
          const ri = refundItems.find((r) => r.itemId.toString() === si._id.toString())
          return { ...si.toObject(), quantity: ri.quantity || si.quantity }
        })
      : sale.items.map((si) => si.toObject())

    // Restore stock
    for (const item of itemsToRefund) {
      const product = await Product.findById(item.product)
      const previousStock = product ? product.stock : 0

      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
      })

      await InventoryTransaction.create({
        product: item.product,
        type: 'return',
        quantity: item.quantity,
        previousStock,
        newStock: previousStock + item.quantity,
        reference: sale.saleNumber,
        note: `Refund of sale ${sale.saleNumber}: ${reason}`,
        performedBy: req.user._id,
      })
    }

    sale.status = 'refunded'
    sale.refundReason = reason
    await sale.save()

    return res.json({ success: true, sale })
  } catch (err) {
    console.error('POST /api/pos/sale/:id/refund error:', err)
    return res.status(500).json({ error: 'Failed to refund sale' })
  }
})

// GET /api/pos/queue — online orders awaiting fulfillment
router.get('/api/pos/queue', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ status: 'paid' })
      .populate('user', 'name email phone')
      .populate('items.product', 'title images')
      .sort({ createdAt: 1 })

    return res.json({ success: true, orders })
  } catch (err) {
    console.error('GET /api/pos/queue error:', err)
    return res.status(500).json({ error: 'Failed to fetch order queue' })
  }
})

module.exports = router
