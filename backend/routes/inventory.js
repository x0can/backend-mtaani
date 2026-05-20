const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { Product, InventoryTransaction } = require('../db')

// GET /api/inventory
router.get('/api/inventory', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { category, lowStock, page = 1, limit = 50, search } = req.query
    const filter = { isActive: true }

    if (category) filter.category = category
    if (search) filter.$text = { $search: search }
    if (lowStock === 'true') {
      filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] }
    }

    const skip = (Number(page) - 1) * Number(limit)
    const sortOrder = lowStock === 'true' ? { stock: 1 } : { title: 1 }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name')
        .sort(sortOrder)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Product.countDocuments(filter),
    ])

    const productsWithStatus = products.map((p) => {
      let stockStatus = 'ok'
      if (p.stock === 0) {
        stockStatus = 'out'
      } else if (p.stock <= (p.lowStockThreshold || 5)) {
        stockStatus = 'low'
      }
      return { ...p, stockStatus }
    })

    return res.json({
      success: true,
      products: productsWithStatus,
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (err) {
    console.error('GET /api/inventory error:', err)
    return res.status(500).json({ error: 'Failed to fetch inventory' })
  }
})

// POST /api/inventory/restock/:productId
router.post('/api/inventory/restock/:productId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { quantity, unitCost, note, reference } = req.body

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' })
    }

    const product = await Product.findById(req.params.productId)
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const previousStock = product.stock
    const newStock = previousStock + Number(quantity)

    await Product.findByIdAndUpdate(req.params.productId, {
      $inc: { stock: Number(quantity) },
    })

    const transaction = await InventoryTransaction.create({
      product: product._id,
      type: 'restock',
      quantity: Number(quantity),
      previousStock,
      newStock,
      unitCost: unitCost || undefined,
      reference: reference || undefined,
      note: note || undefined,
      performedBy: req.user._id,
    })

    product.stock = newStock

    return res.json({ success: true, product, transaction })
  } catch (err) {
    console.error('POST /api/inventory/restock/:productId error:', err)
    return res.status(500).json({ error: 'Failed to restock product' })
  }
})

// POST /api/inventory/adjust/:productId
router.post('/api/inventory/adjust/:productId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { quantity, reason, note } = req.body

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ error: 'quantity is required' })
    }

    const product = await Product.findById(req.params.productId)
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const previousStock = product.stock
    const newStock = previousStock + Number(quantity)

    if (newStock < 0) {
      return res.status(400).json({
        error: `Adjustment would result in negative stock (current: ${previousStock}, adjustment: ${quantity})`,
      })
    }

    await Product.findByIdAndUpdate(req.params.productId, {
      $inc: { stock: Number(quantity) },
    })

    const transaction = await InventoryTransaction.create({
      product: product._id,
      type: 'adjustment',
      quantity: Number(quantity),
      previousStock,
      newStock,
      note: note || reason || undefined,
      performedBy: req.user._id,
    })

    product.stock = newStock

    return res.json({ success: true, product, transaction })
  } catch (err) {
    console.error('POST /api/inventory/adjust/:productId error:', err)
    return res.status(500).json({ error: 'Failed to adjust stock' })
  }
})

// GET /api/inventory/low-stock
router.get('/api/inventory/low-stock', authMiddleware, adminOnly, async (req, res) => {
  try {
    const products = await Product.find({
      isActive: true,
      $expr: { $lte: ['$stock', '$lowStockThreshold'] },
    })
      .populate('category', 'name')
      .sort({ stock: 1 })
      .lean()

    const productsWithStatus = products.map((p) => ({
      ...p,
      stockStatus: p.stock === 0 ? 'out' : 'low',
    }))

    return res.json({ success: true, products: productsWithStatus })
  } catch (err) {
    console.error('GET /api/inventory/low-stock error:', err)
    return res.status(500).json({ error: 'Failed to fetch low stock products' })
  }
})

// GET /api/inventory/history/:productId
router.get('/api/inventory/history/:productId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const product = await Product.findById(req.params.productId).select('title sku barcode')
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const [transactions, total] = await Promise.all([
      InventoryTransaction.find({ product: req.params.productId })
        .populate('performedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InventoryTransaction.countDocuments({ product: req.params.productId }),
    ])

    return res.json({
      success: true,
      product,
      transactions,
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (err) {
    console.error('GET /api/inventory/history/:productId error:', err)
    return res.status(500).json({ error: 'Failed to fetch inventory history' })
  }
})

// GET /api/products/barcode/:code — no auth required (cashier barcode scan)
router.get('/api/products/barcode/:code', async (req, res) => {
  try {
    const code = req.params.code

    const product = await Product.findOne({
      barcode: { $regex: new RegExp(`^${code}$`, 'i') },
      isActive: true,
    }).populate('category', 'name')

    if (!product) {
      return res.status(404).json({ error: 'Product not found for this barcode' })
    }

    return res.json({ success: true, product })
  } catch (err) {
    console.error('GET /api/products/barcode/:code error:', err)
    return res.status(500).json({ error: 'Failed to look up barcode' })
  }
})

module.exports = router
