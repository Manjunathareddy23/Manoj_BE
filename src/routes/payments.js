const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CF_API_VERSION = '2023-08-01';

// IMPORTANT: Read credentials per-request so env var changes take effect without redeploy
const getCFConfig = () => {
  const appId    = process.env.CASHFREE_APP_ID;
  const secret   = process.env.CASHFREE_SECRET_KEY;
  const env      = process.env.CASHFREE_ENV || 'production';
  const baseUrl  = env === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
  return {
    appId, secret, baseUrl,
    headers: {
      'x-api-version':   CF_API_VERSION,
      'x-client-id':     appId,
      'x-client-secret': secret,
      'Content-Type':    'application/json',
    },
  };
};

// GET /api/payments/cashfree/test — verify Cashfree credentials are working (no auth needed)
router.get('/cashfree/test', async (req, res) => {
  const { appId, secret, baseUrl, headers } = getCFConfig();
  if (!appId || !secret) {
    return res.status(500).json({ ok: false, message: 'CASHFREE_APP_ID or CASHFREE_SECRET_KEY not set on server' });
  }
  try {
    const testPayload = {
      order_id: `test_${Date.now()}`,
      order_amount: 1,
      order_currency: 'INR',
      customer_details: { customer_id: 'test_1', customer_email: 'test@test.com', customer_phone: '9999999999', customer_name: 'Test' },
      order_meta: {},
    };
    const r = await axios.post(`${baseUrl}/orders`, testPayload, { headers });
    res.json({ ok: true, order_status: r.data.order_status, payment_session_id: r.data.payment_session_id ? 'present' : 'missing', cf_order_id: r.data.cf_order_id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// POST /api/payments/cashfree/create
router.post('/cashfree/create', authenticateToken, async (req, res) => {
  const { appId, secret, baseUrl, headers } = getCFConfig();

  if (!appId || !secret) {
    return res.status(500).json({ message: 'Payment gateway not configured on server. Contact support.' });
  }

  try {
    const { amount, appOrderId, customerName, customerEmail, customerPhone } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const cfOrderId = `cf_${appOrderId}_${Date.now()}`;

    // Build return URL so Cashfree knows where to redirect after payment
    const frontendUrl = (process.env.FRONTEND_URL || 'https://manjunathareddy26.github.io/Manoj_FE').replace(/\/$/, '');
    const backendUrl  = (process.env.BACKEND_URL  || 'https://farmbridge-7yow.onrender.com').replace(/\/$/, '');
    const returnUrl   = `${frontendUrl}/#/payment/return/${appOrderId}`;
    const notifyUrl   = `${backendUrl}/api/payments/cashfree/webhook`;

    const payload = {
      order_id:       cfOrderId,
      order_amount:   parseFloat(Number(amount).toFixed(2)),
      order_currency: 'INR',
      customer_details: {
        customer_id:    `cust_${req.user.id}`,
        customer_email: customerEmail || 'customer@farmbridgemarket.com',
        customer_phone: (customerPhone || '9999999999').replace(/\D/g, '').slice(-10),
        customer_name:  customerName  || 'Customer',
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
      },
    };

    console.log('Creating Cashfree order:', { cfOrderId, amount: payload.order_amount, appId: appId.slice(0, 8) + '...' });

    const response = await axios.post(`${baseUrl}/orders`, payload, { headers });
    console.log('Cashfree order created:', response.data.cf_order_id, 'status:', response.data.order_status);

    res.json({
      cf_order_id:        response.data.cf_order_id || cfOrderId,
      order_id:           response.data.order_id,
      payment_session_id: response.data.payment_session_id,
    });
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('Cashfree create order error:', errData);
    res.status(500).json({ message: 'Failed to create payment session', error: errData });
  }
});

// POST /api/payments/cashfree/verify
router.post('/cashfree/verify', authenticateToken, async (req, res) => {
  const { baseUrl, headers } = getCFConfig();
  try {
    const { cf_order_id, appOrderId } = req.body;

    if (!cf_order_id) {
      return res.status(400).json({ message: 'Missing cf_order_id' });
    }

    const response = await axios.get(`${baseUrl}/orders/${cf_order_id}`, { headers });
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
router.post('/cashfree/webhook', async (req, res) => {
  const { secret } = getCFConfig();
  try {
    const signature  = req.headers['x-webhook-signature'];
    const timestamp  = req.headers['x-webhook-timestamp'];
    const rawBody    = JSON.stringify(req.body);

    if (signature && timestamp && secret) {
      const signedPayload = timestamp + rawBody;
      const expectedSig   = crypto
        .createHmac('sha256', secret)
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

