const nodemailer = require('nodemailer');

// Create transporter (using Gmail SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'farmbridgemarketplace@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your-app-password',
  },
});

// Send Order Accepted Email to Consumer
const sendOrderAcceptedEmail = async (consumerEmail, consumerName, orderId, orderData) => {
  try {
    const items = JSON.parse(orderData.items || '[]');
    const itemsList = items
      .map((item) => `• ${item.name} - ${item.quantity} ${item.quantityType || 'units'}`)
      .join('\n');

    const mailOptions = {
      from: process.env.EMAIL_USER || 'farmbridgemarketplace@gmail.com',
      to: consumerEmail,
      subject: `✅ Order #${orderId} Accepted by Farmer - FarmBridge`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Order Confirmed! ✅</h1>
          </div>
          
          <div style="background: #f8f8f8; padding: 20px; border-radius: 0 0 8px 8px;">
            <p>Hi <strong>${consumerName}</strong>,</p>
            
            <p>Great news! Your order has been accepted by the farmer and is being processed.</p>
            
            <div style="background: white; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0;">
              <h3 style="margin-top: 0;">Order Details:</h3>
              <p><strong>Order ID:</strong> #${orderId}</p>
              <p><strong>Total Amount:</strong> ₹${orderData.total_amount?.toLocaleString('en-IN')}</p>
              <p><strong>Payment Method:</strong> ${orderData.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}</p>
            </div>
            
            <div style="background: white; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">Items Ordered:</h3>
              <p style="white-space: pre-wrap; margin: 0;">${itemsList}</p>
            </div>
            
            <div style="background: white; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">Delivery Address:</h3>
              <p style="margin: 0;">${orderData.delivery_address || 'N/A'}</p>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              The farmer will update you soon with more details about the delivery timeline.
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            
            <p style="color: #666; font-size: 12px; margin: 0;">
              Best regards,<br>
              <strong>FarmBridge Team</strong><br>
              Your trusted agricultural marketplace
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Order accepted email sent to ${consumerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending acceptance email:', error);
    return false;
  }
};

// Send Order Rejected Email to Consumer
const sendOrderRejectedEmail = async (consumerEmail, consumerName, orderId, reason) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'farmbridgemarketplace@gmail.com',
      to: consumerEmail,
      subject: `⚠️ Order #${orderId} Rejected - FarmBridge`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Order Update ⚠️</h1>
          </div>
          
          <div style="background: #f8f8f8; padding: 20px; border-radius: 0 0 8px 8px;">
            <p>Hi <strong>${consumerName}</strong>,</p>
            
            <p>Unfortunately, the farmer was unable to fulfill your order. Here's the reason:</p>
            
            <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #fd7e14; margin: 20px 0; border-radius: 5px;">
              <p style="margin: 0; font-weight: bold;">📌 Reason for Rejection:</p>
              <p style="margin: 10px 0 0 0;">${reason || 'Not specified'}</p>
            </div>
            
            <p style="color: #666;">
              <strong>What's next?</strong><br>
              • You can place a new order with other farmers<br>
              • Your payment (if any) will be refunded within 3-5 business days<br>
              • Feel free to contact us at support@farmbridgeapp.com for assistance
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            
            <p style="color: #666; font-size: 12px; margin: 0;">
              Best regards,<br>
              <strong>FarmBridge Team</strong><br>
              Your trusted agricultural marketplace
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Order rejected email sent to ${consumerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending rejection email:', error);
    return false;
  }
};

// Send Order Shipped Email
const sendOrderShippedEmail = async (consumerEmail, consumerName, orderId) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'farmbridgemarketplace@gmail.com',
      to: consumerEmail,
      subject: `🚚 Order #${orderId} Shipped - FarmBridge`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Your Order is Shipped! 🚚</h1>
          </div>
          
          <div style="background: #f8f8f8; padding: 20px; border-radius: 0 0 8px 8px;">
            <p>Hi <strong>${consumerName}</strong>,</p>
            
            <p>Your order is on its way! Track your delivery with the tracking information below.</p>
            
            <div style="background: white; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">📦 Shipment Details:</h3>
              <p><strong>Order ID:</strong> #${orderId}</p>
              <p><strong>Status:</strong> Shipped</p>
              <p><strong>Estimated Delivery:</strong> 2-3 business days</p>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              You will receive additional updates about your delivery. If you have any questions, please reach out to the farmer or contact our support team.
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            
            <p style="color: #666; font-size: 12px; margin: 0;">
              Best regards,<br>
              <strong>FarmBridge Team</strong>
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Order shipped email sent to ${consumerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending shipped email:', error);
    return false;
  }
};

// Send Order Delivered Email
const sendOrderDeliveredEmail = async (consumerEmail, consumerName, orderId) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'farmbridgemarketplace@gmail.com',
      to: consumerEmail,
      subject: `✅ Order #${orderId} Delivered - FarmBridge`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Order Delivered! ✅</h1>
          </div>
          
          <div style="background: #f8f8f8; padding: 20px; border-radius: 0 0 8px 8px;">
            <p>Hi <strong>${consumerName}</strong>,</p>
            
            <p>Your order has been successfully delivered! We hope you enjoy the fresh products from our local farmers.</p>
            
            <div style="background: white; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">📦 Order Summary:</h3>
              <p><strong>Order ID:</strong> #${orderId}</p>
              <p><strong>Status:</strong> Delivered</p>
            </div>
            
            <p style="color: #666; margin: 20px 0;">
              <strong>Would you like to leave feedback?</strong><br>
              Rate this order and help us improve our service!
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            
            <p style="color: #666; font-size: 12px; margin: 0;">
              Thank you for choosing FarmBridge!<br>
              <strong>FarmBridge Team</strong>
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Order delivered email sent to ${consumerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending delivered email:', error);
    return false;
  }
};

module.exports = {
  sendOrderAcceptedEmail,
  sendOrderRejectedEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
};
