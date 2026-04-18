const express = require('express');
const pool = require('../config/database');
const { authenticateToken, checkRole } = require('../middleware/auth');

const router = express.Router();

// Farmer Dashboard Stats
router.get('/farmer/stats', authenticateToken, checkRole(['farmer']), async (req, res) => {
  try {
    const farmerId = req.user.id;

    // Count farmer's products
    const [productsResult] = await pool.query(
      'SELECT COUNT(*) as count FROM products WHERE farmer_id = ?',
      [farmerId]
    );

    // Count orders containing farmer's products
    const [ordersResult] = await pool.query(
      `SELECT COUNT(DISTINCT o.id) as count 
       FROM orders o
       INNER JOIN products p ON JSON_CONTAINS(o.items, JSON_OBJECT('productId', p.id))
       WHERE p.farmer_id = ?`,
      [farmerId]
    );

    // Calculate earnings from farmer's products
    const [earningsResult] = await pool.query(
      `SELECT SUM(o.total_amount) as total FROM orders o
       INNER JOIN products p ON JSON_CONTAINS(o.items, JSON_OBJECT('productId', p.id))
       WHERE p.farmer_id = ? AND o.payment_status = 'paid'`,
      [farmerId]
    );

    // Count pending orders for farmer's products
    const [pendingResult] = await pool.query(
      `SELECT COUNT(DISTINCT o.id) as count FROM orders o
       INNER JOIN products p ON JSON_CONTAINS(o.items, JSON_OBJECT('productId', p.id))
       WHERE p.farmer_id = ? AND o.status = 'pending'`,
      [farmerId]
    );

    res.json({
      totalProducts: productsResult[0]?.count || 0,
      ordersReceived: ordersResult[0]?.count || 0,
      earnings: earningsResult[0]?.total || 0,
      pendingOrders: pendingResult[0]?.count || 0,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
});

// Consumer Dashboard Stats
router.get('/consumer/stats', authenticateToken, checkRole(['consumer']), async (req, res) => {
  try {
    const consumerId = req.user.id;

    const [ordersResult] = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE consumer_id = ?',
      [consumerId]
    );

    const [spentResult] = await pool.query(
      'SELECT SUM(total_amount) as total FROM orders WHERE consumer_id = ? AND payment_status = "paid"',
      [consumerId]
    );

    res.json({
      totalOrders: ordersResult[0].count || 0,
      totalSpent: spentResult[0].total || 0,
      favoriteSellers: 0,
      savedItems: 0,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
});

// Farmer Earnings
router.get('/farmer/earnings', authenticateToken, checkRole(['farmer']), async (req, res) => {
  try {
    const farmerId = req.user.id;
    const { period = 'month' } = req.query;

    const [earnings] = await pool.query(
      'SELECT SUM(total_amount) as total FROM orders WHERE farmer_id = ? AND payment_status = "paid"',
      [farmerId]
    );

    res.json({
      period,
      totalEarnings: earnings[0].total || 0,
    });
  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
});

module.exports = router;
