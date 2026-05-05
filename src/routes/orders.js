const express = require('express');
const {
  createOrder,
  getUserOrders,
  getFarmerOrders,
  getOrder,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
  updatePaymentStatus,
  getOrderTracking,
  deleteOrder,
} = require('../controllers/orderController');
const { authenticateToken, checkRole } = require('../middleware/auth');

const router = express.Router();

// Farmer routes (must be defined BEFORE /:id to avoid wildcard conflict)
router.get('/farmer/received', authenticateToken, checkRole(['farmer']), getFarmerOrders);

// Consumer routes
router.post('/', authenticateToken, checkRole(['consumer']), createOrder);
router.get('/', authenticateToken, getUserOrders);
router.get('/:id', authenticateToken, getOrder);
router.get('/:id/tracking', authenticateToken, getOrderTracking);
router.post('/:id/accept', authenticateToken, checkRole(['farmer']), acceptOrder);
router.post('/:id/reject', authenticateToken, checkRole(['farmer']), rejectOrder);
router.put('/:id/status', authenticateToken, checkRole(['farmer']), updateOrderStatus);
router.put('/:id/payment-status', authenticateToken, updatePaymentStatus);
router.delete('/:id', authenticateToken, checkRole(['consumer']), deleteOrder);

module.exports = router;
