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
      order_meta: {
        return_url: 'https://farmbridge-7yow.onrender.com/api/payments/cashfree/return/test',
        notify_url: 'https://farmbridge-7yow.onrender.com/api/payments/cashfree/webhook',
        // Note: Cashfree will append query params: ?cf_order_id=xxx&payment_status=SUCCESS/FAILED/PENDING
      },
    };
    const r = await axios.post(`${baseUrl}/orders`, testPayload, { headers });
    res.json({
      ok: true,
      order_status: r.data.order_status,
      payment_session_id: r.data.payment_session_id ? 'present ✓' : 'MISSING ✗',
      cf_order_id: r.data.cf_order_id,
      fullResponse: r.data,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
      status: err.response?.status,
    });
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

    // Use backend as relay for return_url — Cashfree rejects URLs containing '#' (HashRouter)
    // Backend relay reads Cashfree's appended query params and redirects to the frontend hash route
    const backendUrl  = (process.env.BACKEND_URL  || 'https://farmbridge-7yow.onrender.com').replace(/\/$/, '');
    const frontendUrl = (process.env.FRONTEND_URL || 'https://manjunathareddy26.github.io/Manoj_FE').replace(/\/$/, '');
    
    // return_url: Cashfree redirects here after payment, replaces {order_id} with cf_order_id
    // Using backend relay to avoid hash fragment issues with HashRouter
    const returnUrl   = `${backendUrl}/api/payments/cashfree/return/${appOrderId}`;
    const notifyUrl   = `${backendUrl}/api/payments/cashfree/webhook`;

    // Validate and format customer phone: must be exactly 10 digits
    let formattedPhone = (customerPhone || '9999999999').replace(/\D/g, '');
    if (formattedPhone.length > 10) formattedPhone = formattedPhone.slice(-10);
    if (formattedPhone.length < 10) formattedPhone = formattedPhone.padStart(10, '9');

    const payload = {
      order_id:       cfOrderId,
      order_amount:   parseFloat(Number(amount).toFixed(2)),
      order_currency: 'INR',
      customer_details: {
        customer_id:    `cust_${req.user.id}`,
        customer_email: customerEmail || 'customer@farmbridgemarket.com',
        customer_phone: formattedPhone,
        customer_name:  customerName  || 'Customer',
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
        // Note: Cashfree will append query params: ?cf_order_id=xxx&payment_status=SUCCESS/FAILED/PENDING
      },
    };

    console.log('Creating Cashfree order:', {
      cfOrderId,
      amount: payload.order_amount,
      appId: appId.slice(0, 8) + '...',
      returnUrl,
      baseUrl,
      payload: {
        order_id: payload.order_id,
        order_amount: payload.order_amount,
        order_currency: payload.order_currency,
        customer_phone: payload.customer_details.customer_phone,
      },
    });

    const response = await axios.post(`${baseUrl}/orders`, payload, { headers });
    
    console.log('Cashfree API response:', {
      status: response.status,
      cf_order_id: response.data.cf_order_id,
      order_status: response.data.order_status,
      payment_session_id: response.data.payment_session_id ? `✓ (${response.data.payment_session_id.length} chars)` : '✗ MISSING',
      cf_error_code: response.data.cf_error_code,
      cf_error_message: response.data.cf_error_message,
    });

    // CRITICAL: Validate Cashfree returned BOTH required fields
    if (!response.data.payment_session_id) {
      console.error('ERROR: Cashfree returned no payment_session_id. Full response:', JSON.stringify(response.data));
      return res.status(500).json({
        message: 'Cashfree did not return a payment session',
        details: response.data,
      });
    }

    // CRITICAL: MUST use Cashfree's cf_order_id, not our generated one!
    // Fallback to our ID will cause verification to fail with "order_not_found"
    if (!response.data.cf_order_id) {
      console.error('ERROR: Cashfree returned no cf_order_id. Full response:', JSON.stringify(response.data));
      return res.status(500).json({
        message: 'Cashfree did not return order ID. Payment gateway issue.',
        details: response.data,
      });
    }

    // Return EXACTLY what Cashfree gave us
    res.json({
      cf_order_id:        response.data.cf_order_id,  // ← MUST be Cashfree's ID
      order_id:           response.data.order_id,
      payment_session_id: response.data.payment_session_id,
    });
  } catch (err) {
    const errData = err.response?.data || err.message;
    const statusCode = err.response?.status || 500;
    
    console.error('Cashfree create order ERROR:', {
      status: statusCode,
      message: errData?.message || errData,
      cf_error_code: errData?.cf_error_code,
      cf_error_message: errData?.cf_error_message,
      details: errData,
    });
    
    // Return detailed error to client
    res.status(500).json({
      message: 'Failed to create payment session',
      error: errData?.message || errData,
      cf_error_code: errData?.cf_error_code,
      cf_error_message: errData?.cf_error_message,
      details: errData?.error_details || errData,
    });
  }
});

// POST /api/payments/cashfree/verify
// IMPORTANT: cf_order_id is Cashfree's internal payment ID, NOT our order_id
// Use /orders/pay/fetch/{cf_order_id} endpoint to fetch payments by Cashfree ID
router.post('/cashfree/verify', authenticateToken, async (req, res) => {
  const { baseUrl, headers } = getCFConfig();
  try {
    const { cf_order_id, appOrderId } = req.body;

    console.log('[Verify] Received:', { cf_order_id, appOrderId });

    if (!cf_order_id || cf_order_id === 'undefined') {
      return res.status(400).json({ success: false, message: 'Missing cf_order_id' });
    }

    // ✅ Use the payments endpoint with cf_order_id — this accepts Cashfree's internal ID
    console.log('[Verify] Fetching payments for cf_order_id:', cf_order_id);
    const paymentsRes = await axios.get(
      `${baseUrl}/orders/pay/fetch/${cf_order_id}`,
      { headers, timeout: 10000 }
    );

    console.log('[Verify] Cashfree payments response:', {
      payments_count: Array.isArray(paymentsRes.data) ? paymentsRes.data.length : 'not_array',
      data: JSON.stringify(paymentsRes.data).substring(0, 500),
    });

    // paymentsRes.data is an array of payment objects
    const payments = paymentsRes.data;
    const successPayment = Array.isArray(payments)
      ? payments.find(p => p.payment_status === 'SUCCESS')
      : null;

    if (successPayment) {
      console.log('[Verify] Payment SUCCESS found:', {
        cf_order_id,
        appOrderId,
        payment_id: successPayment.cf_payment_id,
      });

      // Update DB
      if (appOrderId) {
        try {
          const pool = require('../config/database');
          await pool.execute(
            "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
            [appOrderId]
          );
          console.log('[Verify] DB updated for order:', appOrderId);
        } catch (dbErr) {
          console.error('[Verify] DB update failed (non-fatal):', dbErr.message);
          // Don't throw - payment is verified with Cashfree
        }
      }
      return res.json({ success: true, status: 'PAID', cf_order_id, appOrderId });
    }

    // No successful payment found
    const latestStatus = Array.isArray(payments) && payments[0]
      ? payments[0].payment_status
      : 'UNKNOWN';

    console.log('[Verify] No SUCCESS payment found:', { cf_order_id, latestStatus });
    return res.json({ success: false, status: latestStatus, cf_order_id });

  } catch (err) {
    console.error('[Verify] Error:', {
      message: err.message,
      status: err.response?.status,
      cfError: err.response?.data,
    });

    return res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: err.response?.data?.message || err.message,
      cf_error: err.response?.data,
    });
  }
});

// GET /api/payments/cashfree/return/:appOrderId
// Cashfree redirects here after payment. We relay to the frontend hash route.
// (return_url cannot contain '#', so we use the backend as a clean redirect relay)
router.get('/cashfree/return/:appOrderId', (req, res) => {
  const { appOrderId } = req.params;
  // Always use the correct frontend URL - hardcoded for GitHub Pages
  const frontendUrl = 'https://manjunathareddy26.github.io/Manoj_FE';
  
  // Cashfree appends ?cf_order_id=xxx&payment_status=SUCCESS to the return_url
  const qs = new URLSearchParams(req.query).toString();
  const target = `${frontendUrl}/#/payment/return/${appOrderId}${qs ? '?' + qs : ''}`;
  
  console.log('[PaymentReturn] Redirecting to:', target);
  res.redirect(302, target);
});

// POST /api/payments/cashfree/webhook
// Webhook receives payment status updates from Cashfree
// This is the RELIABLE way to verify payments (server-to-server)
router.post('/cashfree/webhook', async (req, res) => {
  const { secret } = getCFConfig();
  try {
    const signature  = req.headers['x-webhook-signature'];
    const timestamp  = req.headers['x-webhook-timestamp'];
    const rawBody    = JSON.stringify(req.body);

    console.log('[Webhook] Received payment update:', {
      signature: signature ? 'present' : 'missing',
      timestamp,
      body: JSON.stringify(req.body).substring(0, 500),
    });

    // Verify webhook signature if present
    if (signature && timestamp && secret) {
      const signedPayload = timestamp + rawBody;
      const expectedSig   = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('base64');
      if (expectedSig !== signature) {
        console.error('[Webhook] Invalid signature');
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
      console.log('[Webhook] ✅ Signature verified');
    }

    const { data } = req.body;
    const orderStatus = data?.order?.order_status;
    const cfOrderId = data?.order?.order_id;  // YOUR order_id: cf_{appOrderId}_{timestamp}

    console.log('[Webhook] Payment status:', {
      orderStatus,
      cfOrderId,
      cf_payment_id: data?.payment?.cf_payment_id,
    });

    if (orderStatus === 'PAID' && cfOrderId) {
      // Extract app order ID from our custom order_id format: cf_{appOrderId}_{timestamp}
      const parts = cfOrderId.split('_');
      const appOrderId = parts[1];

      console.log('[Webhook] Payment PAID:', { cfOrderId, appOrderId });

      if (appOrderId) {
        try {
          const pool = require('../config/database');
          const [result] = await pool.execute(
            "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
            [appOrderId]
          );
          console.log('[Webhook] ✅ DB updated:', { appOrderId, affectedRows: result.affectedRows });
        } catch (dbErr) {
          console.error('[Webhook] DB update error (non-fatal):', dbErr.message);
          // Continue anyway - webhook must return 200 to Cashfree
        }
      }
    } else {
      console.log('[Webhook] Payment not PAID, skipping DB update:', { orderStatus, cfOrderId });
    }

    // MUST return 200 to Cashfree
    res.json({ success: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    // Even on error, return 200 to acknowledge receipt
    res.status(200).json({ message: 'Webhook received' });
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

