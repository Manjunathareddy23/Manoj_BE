const pool = require('../config/database');
const { sendOrderAcceptedEmail, sendOrderRejectedEmail, sendOrderShippedEmail, sendOrderDeliveredEmail } = require('../services/emailService');

// MySQL JSON columns are auto-parsed by mysql2; this handles both cases safely
const parseItems = (items) => Array.isArray(items) ? items : JSON.parse(items || '[]');

// Create Order
const createOrder = async (req, res) => {
  try {
    const { items, totalAmount, paymentMethod, deliveryAddress, customerName, customerEmail, customerPhone } = req.body;
    const consumerId = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ message: 'Invalid order amount' });
    }

    // Insert order
    const [result] = await pool.query(
      `INSERT INTO orders (consumer_id, total_amount, payment_method, delivery_address, status, customer_name, customer_email, customer_phone, items, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        consumerId,
        totalAmount,
        paymentMethod || 'cod',
        deliveryAddress,
        'pending',
        customerName,
        customerEmail,
        customerPhone,
        JSON.stringify(items)
      ]
    );

    // Update product stock (reduce available bags)
    for (const item of items) {
      const bagsToReduce = item.quantityType === 'weight' 
        ? Math.ceil(item.quantity / item.weight_per_bag) 
        : item.quantity;

      await pool.query(
        'UPDATE products SET bags = bags - ? WHERE id = ? AND bags >= ?',
        [bagsToReduce, item.productId, bagsToReduce]
      );
    }

    res.status(201).json({
      message: 'Order created successfully',
      orderId: result.insertId,
      data: {
        id: result.insertId,
        totalAmount,
        paymentMethod,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Order creation failed', error: error.message });
  }
};

// Get Consumer Orders
const getUserOrders = async (req, res) => {
  try {
    const consumerId = req.user.id;

    const [orders] = await pool.query(
      `SELECT id, consumer_id, total_amount, payment_method, payment_status, delivery_address, status, 
              customer_name, customer_email, customer_phone, items, rejection_reason, created_at, updated_at 
       FROM orders 
       WHERE consumer_id = ? 
       ORDER BY created_at DESC`,
      [consumerId]
    );

    // Parse JSON items
    const parsedOrders = orders.map(order => ({
      ...order,
      items: parseItems(order.items)
    }));

    res.json(parsedOrders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
  }
};

// Get Farmer Received Orders (only paid orders)
const getFarmerOrders = async (req, res) => {
  try {
    const farmerId = req.user.id;

    // Get only PAID orders that contain products from this farmer
    const [orders] = await pool.query(
      `SELECT DISTINCT o.id, o.consumer_id, o.total_amount, o.payment_method, 
              o.payment_status, o.delivery_address, o.status, o.customer_name, 
              o.customer_email, o.customer_phone, o.items, o.created_at, o.updated_at
       FROM orders o
       WHERE o.payment_status = 'paid'
       AND o.id IN (
         SELECT DISTINCT o2.id
         FROM orders o2
         INNER JOIN products p ON p.farmer_id = ?
         WHERE JSON_CONTAINS(o2.items, JSON_OBJECT('productId', p.id))
       )
       ORDER BY o.created_at DESC`,
      [farmerId]
    );

    // Parse JSON items
    const parsedOrders = orders.map(order => ({
      ...order,
      items: parseItems(order.items)
    }));

    res.json(parsedOrders);
  } catch (error) {
    console.error('Error fetching farmer orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
  }
};

// Get Single Order
const getOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [orders] = await pool.query(
      `SELECT id, consumer_id, total_amount, payment_method, payment_status, delivery_address, status, 
              customer_name, customer_email, customer_phone, items, created_at, updated_at 
       FROM orders 
       WHERE id = ? AND consumer_id = ?`,
      [id, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = {
      ...orders[0],
      items: parseItems(orders[0].items)
    };

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: 'Failed to fetch order', error: error.message });
  }
};

// Accept Order (Farmer)
const acceptOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const [orders] = await pool.query(
      'SELECT id, customer_name, customer_email, total_amount, payment_method, delivery_address, items FROM orders WHERE id = ?',
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['accepted', id]
    );

    // Send email notification to consumer (non-blocking)
    const order = orders[0];
    sendOrderAcceptedEmail(order.customer_email, order.customer_name, id, order).catch(err =>
      console.error('Email send failed (non-fatal):', err.message)
    );

    res.json({ message: 'Order accepted successfully' });
  } catch (error) {
    console.error('Error accepting order:', error);
    res.status(500).json({ message: 'Failed to accept order', error: error.message });
  }
};

// Reject Order (Farmer)
const rejectOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [orders] = await pool.query(
      'SELECT items, customer_name, customer_email FROM orders WHERE id = ?',
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Restore product bags to inventory
    const items = parseItems(orders[0].items);
    for (const item of items) {
      const bagsToAdd = item.quantityType === 'weight' 
        ? Math.ceil(item.quantity / item.weight_per_bag) 
        : item.quantity;

      await pool.query(
        'UPDATE products SET bags = bags + ? WHERE id = ?',
        [bagsToAdd, item.productId]
      );
    }

    const orderInfo = orders; // Already fetched above

    await pool.query(
      'UPDATE orders SET status = ?, rejection_reason = ?, updated_at = NOW() WHERE id = ?',
      ['rejected', reason || '', id]
    );

    // Send rejection email (non-blocking)
    if (orderInfo.length > 0) {
      const { customer_name, customer_email } = orderInfo[0];
      sendOrderRejectedEmail(customer_email, customer_name, id, reason).catch(err =>
        console.error('Email send failed (non-fatal):', err.message)
      );
    }

    res.json({ message: 'Order rejected successfully' });
  } catch (error) {
    console.error('Error rejecting order:', error);
    res.status(500).json({ message: 'Failed to reject order', error: error.message });
  }
};

// Update Order Status (Farmer - for delivery tracking)
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const farmerId = req.user.id;

    const validStatuses = ['pending', 'accepted', 'confirmed', 'packed', 'shipped', 'delivered', 'rejected'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }

    // Verify order belongs to farmer's products
    const [orders] = await pool.query(
      `SELECT id, items FROM orders WHERE id = ?`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // If status is 'delivered', set delivery_date
    let updateQuery = 'UPDATE orders SET status = ?, updated_at = NOW()';
    let updateParams = [status, id];

    if (status === 'delivered') {
      updateQuery += ', delivery_date = NOW()';
      updateParams = [status, id];
    }

    updateQuery += ' WHERE id = ?';

    const [result] = await pool.query(updateQuery, updateParams);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Send shipping/delivery email notifications (non-blocking)
    const [orderInfo] = await pool.query(
      'SELECT customer_name, customer_email FROM orders WHERE id = ?',
      [id]
    );
    if (orderInfo.length > 0) {
      const { customer_name, customer_email } = orderInfo[0];
      if (status === 'shipped') {
        sendOrderShippedEmail(customer_email, customer_name, id).catch(err =>
          console.error('Email send failed (non-fatal):', err.message)
        );
      } else if (status === 'delivered') {
        sendOrderDeliveredEmail(customer_email, customer_name, id).catch(err =>
          console.error('Email send failed (non-fatal):', err.message)
        );
      }
    }

    res.json({ message: `Order status updated to ${status}` });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Failed to update order', error: error.message });
  }
};

// Update Payment Status
const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    const validPaymentStatuses = ['unpaid', 'pending_payment', 'paid', 'failed'];
    
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({ message: 'Invalid payment status' });
    }

    // If payment is marked as paid, also update order status to 'confirmed'
    let query = 'UPDATE orders SET payment_status = ?, updated_at = NOW()';
    let params = [paymentStatus, id];

    if (paymentStatus === 'paid') {
      query = 'UPDATE orders SET payment_status = ?, status = ?, updated_at = NOW() WHERE id = ?';
      params = [paymentStatus, 'confirmed', id];
    } else {
      query += ' WHERE id = ?';
    }

    const [result] = await pool.query(query, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({ message: 'Payment status updated successfully' });
  } catch (error) {
    console.error('Error updating payment status:', error);
    res.status(500).json({ message: 'Failed to update payment status', error: error.message });
  }
};

// Get Order Tracking Details (Consumer view)
const getOrderTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const consumerId = req.user.id;

    const [orders] = await pool.query(
      `SELECT * FROM orders WHERE id = ? AND consumer_id = ?`,
      [id, consumerId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = {
      ...orders[0],
      items: parseItems(orders[0].items)
    };

    res.json(order);
  } catch (error) {
    console.error('Error fetching order tracking:', error);
    res.status(500).json({ message: 'Failed to fetch order tracking', error: error.message });
  }
};


// Delete Order (Consumer only � delivered or rejected orders)
const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const consumerId = req.user.id;

    const [rows] = await pool.query(
      'SELECT id, consumer_id, status FROM orders WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = rows[0];

    if (order.consumer_id !== consumerId) {
      return res.status(403).json({ message: 'Not authorised to delete this order' });
    }

    const deletableStatuses = ['delivered', 'rejected'];
    if (!deletableStatuses.includes(order.status)) {
      return res.status(400).json({ message: 'Only delivered or rejected orders can be deleted' });
    }

    await pool.query('DELETE FROM orders WHERE id = ?', [id]);

    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: 'Failed to delete order', error: error.message });
  }
};
module.exports = {
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
};
