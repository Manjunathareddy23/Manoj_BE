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

    // ✅ Save cf_order_id to database so sync endpoint can find it later
    try {
      const pool = require('../config/database');
      const [result] = await pool.execute(
        'UPDATE orders SET cf_order_id = ? WHERE id = ?',
        [response.data.cf_order_id, appOrderId]
      );
      console.log('[Create] Saved cf_order_id to database:', {
        appOrderId,
        cf_order_id: response.data.cf_order_id,
        affectedRows: result.affectedRows,
      });
    } catch (dbErr) {
      console.error('[Create] Failed to save cf_order_id to DB:', dbErr.message);
      // Don't fail the payment creation if DB update fails - still return session to frontend
      // Frontend can use sync endpoint with the cf_order_id we're returning
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
// ⚠️  NO AUTHENTICATION - Cashfree calls this, not our frontend
router.post('/cashfree/webhook', async (req, res) => {
  const { secret } = getCFConfig();
  try {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Webhook] 🔔 PAYMENT WEBHOOK RECEIVED at ${timestamp}`);
    console.log(`${'='.repeat(80)}`);

    const signature  = req.headers['x-webhook-signature'];
    const webhookTimestamp  = req.headers['x-webhook-timestamp'];
    const rawBody    = JSON.stringify(req.body);

    console.log('[Webhook] Headers:', {
      signature: signature ? `present (${signature.substring(0, 20)}...)` : 'MISSING',
      timestamp: webhookTimestamp,
      contentType: req.headers['content-type'],
    });

    console.log('[Webhook] Raw Body:', rawBody.substring(0, 1000));

    // Verify webhook signature if present
    if (signature && webhookTimestamp && secret) {
      const signedPayload = webhookTimestamp + rawBody;
      const expectedSig   = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('base64');
      if (expectedSig !== signature) {
        console.error('[Webhook] ❌ INVALID SIGNATURE - Expected:', expectedSig, 'Got:', signature);
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
      console.log('[Webhook] ✅ Signature verified');
    } else {
      console.warn('[Webhook] ⚠️  No signature verification (missing headers)');
    }

    const { data } = req.body;
    const orderStatus = data?.order?.order_status;
    const cfOrderId = data?.order?.order_id;  // YOUR order_id: cf_{appOrderId}_{timestamp}
    const cfPaymentId = data?.payment?.cf_payment_id;
    const paymentAmount = data?.payment?.payment_amount;

    console.log('[Webhook] Extracted Data:', {
      orderStatus,
      cfOrderId,
      cfPaymentId,
      paymentAmount,
    });

    if (orderStatus === 'PAID' && cfOrderId) {
      // Extract app order ID from our custom order_id format: cf_{appOrderId}_{timestamp}
      const parts = cfOrderId.split('_');
      const appOrderId = parts[1];

      console.log('[Webhook] ✅ PAYMENT PAID - Processing:', { 
        cfOrderId, 
        appOrderId,
        extractedParts: parts,
        expectedFormat: 'cf_{appOrderId}_{timestamp}',
      });

      if (appOrderId && appOrderId !== 'undefined') {
        try {
          const pool = require('../config/database');
          
          // First, get the order details before update
          const [orderBefore] = await pool.execute(
            "SELECT id, status, payment_status FROM orders WHERE id = ?",
            [appOrderId]
          );
          
          if (!orderBefore.length) {
            console.error('[Webhook] ❌ Order not found in database:', { appOrderId });
            return res.status(200).json({ message: 'Webhook received but order not found' });
          }
          
          console.log('[Webhook] Order BEFORE update:', orderBefore[0]);
          
          // Update the order
          const [result] = await pool.execute(
            "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
            [appOrderId]
          );
          
          console.log('[Webhook] Update Result:', { 
            appOrderId, 
            affectedRows: result.affectedRows,
            message: result.affectedRows > 0 ? 'Successfully updated' : 'NO ROWS UPDATED',
          });
          
          // Verify the update
          if (result.affectedRows > 0) {
            const [updated] = await pool.execute(
              "SELECT id, status, payment_status FROM orders WHERE id = ?",
              [appOrderId]
            );
            console.log('[Webhook] ✅ Order AFTER update:', updated[0]);
          }
        } catch (dbErr) {
          console.error('[Webhook] ❌ DB Error:', {
            appOrderId,
            error: dbErr.message,
            code: dbErr.code,
            sqlState: dbErr.sqlState,
          });
          // Continue anyway - webhook must return 200 to Cashfree
        }
      } else {
        console.warn('[Webhook] ⚠️  Could not extract valid appOrderId:', { cfOrderId, parts, appOrderId });
      }
    } else {
      console.log('[Webhook] ℹ️  Not processing as PAID:', { 
        orderStatus, 
        cfOrderId,
      });
    }

    console.log(`[Webhook] ✅ Webhook processed, returning 200 to Cashfree`);
    console.log(`${'='.repeat(80)}\n`);

    // MUST return 200 to Cashfree
    res.json({ success: true, message: 'Webhook received' });
  } catch (err) {
    console.error('[Webhook] ❌ Unexpected Error:', err);
    // Even on error, return 200 to acknowledge receipt
    res.status(200).json({ message: 'Webhook received', error: err.message });
  }
});

// POST /api/payments/cashfree/webhook/test/:appOrderId
// Test endpoint to manually simulate a webhook payment for an order
// Usage: POST http://localhost:5000/api/payments/cashfree/webhook/test/123
router.post('/cashfree/webhook/test/:appOrderId', async (req, res) => {
  try {
    const { appOrderId } = req.params;
    
    console.log(`\n[WebhookTest] Testing webhook for order ${appOrderId}\n`);
    
    // Simulate Cashfree webhook payload
    const mockWebhookPayload = {
      data: {
        order: {
          order_id: `cf_${appOrderId}_${Date.now()}`,
          order_status: 'PAID',
          order_amount: 1.0,
        },
        payment: {
          cf_payment_id: '12345test',
          payment_amount: 1.0,
          payment_status: 'SUCCESS',
        },
      },
    };
    
    console.log('[WebhookTest] Simulating webhook payload:', mockWebhookPayload);
    
    // Call the webhook handler via axios to simulate Cashfree's request
    const response = await axios.post(
      `http://localhost:${process.env.PORT || 5000}/api/payments/cashfree/webhook`,
      mockWebhookPayload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    res.json({ 
      success: true, 
      message: 'Test webhook sent to handler',
      webhookResponse: response.data,
    });
  } catch (err) {
    console.error('[WebhookTest] Error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message,
    });
  }
});

// POST /api/payments/mark-paid/:orderId (admin testing only)
// Directly mark an order as paid (for testing/emergency only)
router.post('/mark-paid/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const pool = require('../config/database');
    
    // Get order before update
    const [orderBefore] = await pool.execute(
      "SELECT id, status, payment_status FROM orders WHERE id = ?",
      [orderId]
    );
    
    if (!orderBefore.length) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    console.log('[ManualPaid] Before:', orderBefore[0]);
    
    // Update order
    const [result] = await pool.execute(
      "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
      [orderId]
    );
    
    // Get order after update
    const [orderAfter] = await pool.execute(
      "SELECT id, status, payment_status FROM orders WHERE id = ?",
      [orderId]
    );
    
    console.log('[ManualPaid] After:', orderAfter[0]);
    
    res.json({
      success: result.affectedRows > 0,
      before: orderBefore[0],
      after: orderAfter[0],
      affectedRows: result.affectedRows,
    });
  } catch (err) {
    console.error('[ManualPaid] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/cashfree/sync/:appOrderId
// Check payment status from Cashfree and update database if paid
// This is called from frontend after payment redirect to verify and sync status
router.post('/cashfree/sync/:appOrderId', authenticateToken, async (req, res) => {
  try {
    const { appOrderId } = req.params;
    const { baseUrl, headers } = getCFConfig();
    const pool = require('../config/database');

    console.log(`\n[Sync] Checking Cashfree payment status for order ${appOrderId}`);

    // Get order to find the cf_order_id we stored
    const [orders] = await pool.execute(
      "SELECT id, cf_order_id FROM orders WHERE id = ?",
      [appOrderId]
    );

    if (!orders.length) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const cfOrderId = orders[0].cf_order_id;
    
    if (!cfOrderId || cfOrderId === 'null' || cfOrderId === 'undefined') {
      console.log('[Sync] ⚠️  Order has no cf_order_id stored');
      return res.json({ 
        success: false, 
        message: 'Cashfree order ID not found',
        status: 'unknown',
      });
    }

    console.log('[Sync] Found cf_order_id:', cfOrderId);

    // Query Cashfree for payment status
    try {
      const paymentsRes = await axios.get(
        `${baseUrl}/orders/pay/fetch/${cfOrderId}`,
        { headers, timeout: 10000 }
      );

      const payments = paymentsRes.data;
      const successPayment = Array.isArray(payments)
        ? payments.find(p => p.payment_status === 'SUCCESS')
        : null;

      if (successPayment) {
        console.log('[Sync] ✅ Payment SUCCESS confirmed by Cashfree');
        
        // Update database
        const [result] = await pool.execute(
          "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
          [appOrderId]
        );

        console.log('[Sync] Updated order:', { appOrderId, affectedRows: result.affectedRows });

        return res.json({
          success: true,
          status: 'PAID',
          message: 'Payment confirmed and order updated',
          updated: result.affectedRows > 0,
        });
      }

      // Check latest payment status
      const latestStatus = Array.isArray(payments) && payments[0]
        ? payments[0].payment_status
        : 'UNKNOWN';

      console.log('[Sync] Payment status from Cashfree:', latestStatus);

      return res.json({
        success: false,
        status: latestStatus,
        message: `Payment status: ${latestStatus}`,
      });

    } catch (cfErr) {
      console.error('[Sync] Cashfree API error:', cfErr.response?.data || cfErr.message);
      return res.json({
        success: false,
        status: 'error',
        message: 'Could not reach Cashfree API',
      });
    }

  } catch (err) {
    console.error('[Sync] Error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message,
    });
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

// GET /api/payments/diagnose/:orderId
// Diagnostic endpoint to debug payment status issues
router.get('/diagnose/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const pool = require('../config/database');
    const { baseUrl, headers } = getCFConfig();

    console.log(`\n[Diagnose] Checking order ${orderId}...`);

    // Get order from database
    const [orderRows] = await pool.execute(
      'SELECT id, cf_order_id, payment_status, status FROM orders WHERE id = ?',
      [orderId]
    );

    if (!orderRows.length) {
      return res.status(404).json({ error: 'Order not found in database' });
    }

    const order = orderRows[0];
    console.log('[Diagnose] Order in DB:', order);

    const result = {
      orderId,
      databaseStatus: {
        id: order.id,
        cf_order_id: order.cf_order_id,
        payment_status: order.payment_status,
        status: order.status,
      },
      cashfreeStatus: null,
      error: null,
    };

    // If no cf_order_id, we can't check Cashfree
    if (!order.cf_order_id || order.cf_order_id === 'null' || order.cf_order_id === 'undefined') {
      result.error = 'No cf_order_id in database - order was never sent to Cashfree';
      return res.json(result);
    }

    // Query Cashfree
    try {
      const cfRes = await axios.get(
        `${baseUrl}/orders/pay/fetch/${order.cf_order_id}`,
        { headers, timeout: 10000 }
      );

      const payments = Array.isArray(cfRes.data) ? cfRes.data : [cfRes.data];
      console.log('[Diagnose] Cashfree response:', payments);

      result.cashfreeStatus = {
        totalPayments: payments.length,
        payments: payments.map(p => ({
          cf_payment_id: p.cf_payment_id,
          payment_status: p.payment_status,
          payment_amount: p.payment_amount,
          payment_method: p.payment_method,
          created_at: p.created_at,
        })),
        hasPaidPayment: payments.some(p => p.payment_status === 'SUCCESS'),
      };

      // Check if we found a SUCCESS payment
      const successPayment = payments.find(p => p.payment_status === 'SUCCESS');
      if (successPayment) {
        result.recommendation = `✅ Payment SUCCESS found in Cashfree! Database payment_status is "${order.payment_status}" but should be "paid". Call /api/payments/cashfree/sync/${orderId} to sync.`;
      } else {
        result.recommendation = '⚠️ No SUCCESS payment found in Cashfree. Check if payment was actually completed.';
      }
    } catch (cfErr) {
      result.error = `Cashfree API error: ${cfErr.response?.data?.message || cfErr.message}`;
      console.error('[Diagnose] Cashfree error:', cfErr.response?.data || cfErr.message);
    }

    res.json(result);
  } catch (err) {
    console.error('[Diagnose] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/manual-mark-paid/:orderId
// TESTING ENDPOINT: Manually mark order as paid (for debugging when sync fails)
// This is a last resort to fix payment status when webhook/sync don't work
router.post('/manual-mark-paid/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const pool = require('../config/database');

    console.log(`\n[ManualMarkPaid] Attempting to mark order ${orderId} as paid...`);

    // Get current order status
    const [orderBefore] = await pool.execute(
      'SELECT id, payment_status, status FROM orders WHERE id = ?',
      [orderId]
    );

    if (!orderBefore.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log('[ManualMarkPaid] Before:', orderBefore[0]);

    // Update to paid
    const [result] = await pool.execute(
      "UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?",
      [orderId]
    );

    // Get updated order
    const [orderAfter] = await pool.execute(
      'SELECT id, payment_status, status FROM orders WHERE id = ?',
      [orderId]
    );

    console.log('[ManualMarkPaid] After:', orderAfter[0]);
    console.log('[ManualMarkPaid] ✅ Successfully updated:', {
      orderId,
      affectedRows: result.affectedRows,
      before: orderBefore[0],
      after: orderAfter[0],
    });

    res.json({
      success: result.affectedRows > 0,
      message: `Order ${orderId} marked as PAID`,
      before: orderBefore[0],
      after: orderAfter[0],
      affectedRows: result.affectedRows,
    });
  } catch (err) {
    console.error('[ManualMarkPaid] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

