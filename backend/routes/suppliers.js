const express = require('express')
const router = express.Router()
const { authMiddleware, adminOnly } = require('../auth')
const { Supplier, PurchaseOrder, Product, InventoryTransaction } = require('../db')

// POST /api/suppliers
router.post('/api/suppliers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, contactName, phone, email, address, taxId, paymentTerms, notes } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Supplier name is required' })
    }

    const supplier = await Supplier.create({
      name,
      contactName,
      phone,
      email,
      address,
      taxId,
      paymentTerms,
      notes,
    })

    return res.status(201).json({ success: true, supplier })
  } catch (err) {
    console.error('POST /api/suppliers error:', err)
    return res.status(500).json({ error: 'Failed to create supplier' })
  }
})

// GET /api/suppliers
router.get('/api/suppliers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { search, active } = req.query
    const filter = {}

    if (active !== undefined) {
      filter.active = active === 'true'
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    const suppliers = await Supplier.find(filter).sort({ name: 1 })

    return res.json({ success: true, suppliers })
  } catch (err) {
    console.error('GET /api/suppliers error:', err)
    return res.status(500).json({ error: 'Failed to fetch suppliers' })
  }
})

// PUT /api/suppliers/:id
router.put('/api/suppliers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    return res.json({ success: true, supplier })
  } catch (err) {
    console.error('PUT /api/suppliers/:id error:', err)
    return res.status(500).json({ error: 'Failed to update supplier' })
  }
})

// DELETE /api/suppliers/:id — soft delete
router.delete('/api/suppliers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    )

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    return res.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/suppliers/:id error:', err)
    return res.status(500).json({ error: 'Failed to deactivate supplier' })
  }
})

// POST /api/purchase-orders
router.post('/api/purchase-orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { supplierId, items, notes, expectedAt } = req.body

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId is required' })
    }
    if (!items || !items.length) {
      return res.status(400).json({ error: 'items are required' })
    }

    const supplier = await Supplier.findById(supplierId)
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' })
    }

    // Build line items with product name snapshot and lineTotal
    const lineItems = []
    let totalCost = 0

    for (const item of items) {
      const product = await Product.findById(item.productId).select('title')
      const lineTotal = (item.quantity || 0) * (item.unitCost || 0)
      totalCost += lineTotal
      lineItems.push({
        product: item.productId,
        productName: product ? product.title : '',
        quantity: item.quantity,
        receivedQuantity: 0,
        unitCost: item.unitCost,
        lineTotal,
      })
    }

    const poNumber = 'PO-' + Date.now()

    const po = await PurchaseOrder.create({
      poNumber,
      supplier: supplierId,
      items: lineItems,
      status: 'draft',
      orderedBy: req.user._id,
      notes,
      expectedAt: expectedAt ? new Date(expectedAt) : undefined,
      totalCost,
    })

    const populated = await PurchaseOrder.findById(po._id)
      .populate('supplier', 'name contactName phone email')
      .populate('items.product', 'title sku barcode')
      .populate('orderedBy', 'name email')

    return res.status(201).json({ success: true, po: populated })
  } catch (err) {
    console.error('POST /api/purchase-orders error:', err)
    return res.status(500).json({ error: 'Failed to create purchase order' })
  }
})

// GET /api/purchase-orders
router.get('/api/purchase-orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { supplierId, status, page = 1, limit = 20 } = req.query
    const filter = {}

    if (supplierId) filter.supplier = supplierId
    if (status) filter.status = status

    const skip = (Number(page) - 1) * Number(limit)

    const [pos, total] = await Promise.all([
      PurchaseOrder.find(filter)
        .populate('supplier', 'name contactName phone')
        .populate('orderedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      PurchaseOrder.countDocuments(filter),
    ])

    return res.json({ success: true, pos, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('GET /api/purchase-orders error:', err)
    return res.status(500).json({ error: 'Failed to fetch purchase orders' })
  }
})

// GET /api/purchase-orders/:id
router.get('/api/purchase-orders/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('supplier', 'name contactName phone email address paymentTerms')
      .populate('items.product', 'title sku barcode price stock')
      .populate('orderedBy', 'name email')
      .populate('receivedBy', 'name email')

    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    return res.json({ success: true, po })
  } catch (err) {
    console.error('GET /api/purchase-orders/:id error:', err)
    return res.status(500).json({ error: 'Failed to fetch purchase order' })
  }
})

// PUT /api/purchase-orders/:id/receive
router.put('/api/purchase-orders/:id/receive', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { items: receivedItems } = req.body

    if (!receivedItems || !receivedItems.length) {
      return res.status(400).json({ error: 'items are required' })
    }

    const po = await PurchaseOrder.findById(req.params.id)
    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }
    if (po.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot receive a cancelled purchase order' })
    }

    for (const ri of receivedItems) {
      const lineItem = po.items.id(ri.itemId)
      if (!lineItem) continue

      const qty = Number(ri.receivedQuantity) || 0
      lineItem.receivedQuantity = (lineItem.receivedQuantity || 0) + qty

      if (lineItem.product && qty > 0) {
        const product = await Product.findById(lineItem.product)
        const previousStock = product ? product.stock : 0

        await Product.findByIdAndUpdate(lineItem.product, {
          $inc: { stock: qty },
        })

        await InventoryTransaction.create({
          product: lineItem.product,
          type: 'restock',
          quantity: qty,
          previousStock,
          newStock: previousStock + qty,
          unitCost: lineItem.unitCost,
          reference: po.poNumber,
          note: `Received against PO ${po.poNumber}`,
          performedBy: req.user._id,
        })
      }
    }

    // Determine new status
    const allReceived = po.items.every(
      (item) => item.receivedQuantity >= item.quantity
    )
    po.status = allReceived ? 'received' : 'partial'
    po.receivedBy = req.user._id
    po.receivedAt = new Date()

    await po.save()

    return res.json({ success: true, po })
  } catch (err) {
    console.error('PUT /api/purchase-orders/:id/receive error:', err)
    return res.status(500).json({ error: 'Failed to receive purchase order' })
  }
})

// PUT /api/purchase-orders/:id/status
router.put('/api/purchase-orders/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body
    const allowed = ['draft', 'sent', 'partial', 'received', 'cancelled']

    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` })
    }

    const po = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('supplier', 'name')

    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    return res.json({ success: true, po })
  } catch (err) {
    console.error('PUT /api/purchase-orders/:id/status error:', err)
    return res.status(500).json({ error: 'Failed to update purchase order status' })
  }
})

module.exports = router
