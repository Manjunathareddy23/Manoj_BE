const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CF_APP_ID     = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_ENV        = process.env.CASHFREE_ENV || 'production';
const CF_BASE_URL   = CF_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';
const CF_API_VERSION = '2023-08-01';

const cfHeaders = {
  'x-api-version':    CF_API_VERSION,
  'x-client-id':      CF_APP_ID,
  'x-client-secret':  CF_SECRET_KEY,
  'Content-Type':     'application/json',
};

// POST /api/payments/cashfree/create
// Creates a Cashfree order and returns payment_session_id
router.post('/cashfree/create', authenticateToken, async (req, res) => {
  try {
    const { amount, appOrderId, customerName, customerEmail, customerPhone } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const cfOrderId = `order_${appOrderId}_${Date.now()}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const backendUrl  = process.env.BACKEND_URL  || '';

    const payload = {
      order_id:       cfOrderId,
      order_amount:   Number(amount),
      order_currency: 'INR',
      customer_details: {
        customer_id:    `cust_${req.user.id}`,
        customer_email: customerEmail || 'customer@farmbridgemarket.com',
        customer_phone: customerPhone || '9999999999',
        customer_name:  customerName  || 'Customer',
      },
      // Cashfree requires whitelisted domain for return_url — omit to avoid session invalid error
      order_meta: {
        ...(backendUrl.startsWith('https://')
          ? { notify_url: `${backendUrl}/api/payments/cashfree/webhook` }
          : {}),
      },
    };

    const response = await axios.post(`${CF_BASE_URL}/orders`, payload, { headers: cfHeaders });

    res.json({
      cf_order_id:        response.data.cf_order_id || cfOrderId,
      order_id:           response.data.order_id,
      payment_session_id: response.data.payment_session_id,
    });
  } catch (err) {
    console.error('Cashfree create order error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to create payment session', error: err.response?.data || err.message });
  }
});

// POST /api/payments/cashfree/verify
// Verifies Cashfree payment by checking order status with Cashfree API
router.post('/cashfree/verify', authenticateToken, async (req, res) => {
  try {
    const { cf_order_id, appOrderId } = req.body;

    if (!cf_order_id) {
      return res.status(400).json({ message: 'Missing cf_order_id' });
    }

    const response = await axios.get(`${CF_BASE_URL}/orders/${cf_order_id}`, { headers: cfHeaders });
    const orderStatus = response.data.order_status;

    if (orderStatus === 'PAID') {
      if (appOrderId) {
        const pool = require('../config/database');
        await pool.execute(
          "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
          [appOrderId]
        );
      }
      return res.json({ success: true, status: 'PAID', message: 'Payment verified successfully' });
    }

    res.json({ success: false, status: orderStatus, message: `Payment status: ${orderStatus}` });
  } catch (err) {
    console.error('Cashfree verify error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Payment verification failed', error: err.response?.data || err.message });
  }
});

// POST /api/payments/cashfree/webhook
// Cashfree webhook — auto-marks order paid on server side
router.post('/cashfree/webhook', async (req, res) => {
  try {
    const signature  = req.headers['x-webhook-signature'];
    const timestamp  = req.headers['x-webhook-timestamp'];
    const rawBody    = JSON.stringify(req.body);

    // Verify webhook signature
    if (signature && timestamp) {
      const signedPayload = timestamp + rawBody;
      const expectedSig   = crypto
        .createHmac('sha256', CF_SECRET_KEY)
        .update(signedPayload)
        .digest('base64');
      if (expectedSig !== signature) {
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
    }

    const { data } = req.body;
    if (data?.order?.order_status === 'PAID') {
      // Extract app order ID from cf order_id format: order_{appOrderId}_{timestamp}
      const parts = (data.order.order_id || '').split('_');
      const appOrderId = parts[1];
      if (appOrderId) {
        const pool = require('../config/database');
        await pool.execute(
          "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
          [appOrderId]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Cashfree webhook error:', err.message);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

// GET /api/payments/status/:orderId
router.get('/status/:orderId', authenticateToken, async (req, res) => {
  try {
    const pool = require('../config/database');
    const [rows] = await pool.execute(
      'SELECT id, payment_status, status FROM orders WHERE id = ?',
      [req.params.orderId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Order not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get payment status' });
  }
});

module.exports = router;

