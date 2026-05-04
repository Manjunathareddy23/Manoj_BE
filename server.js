require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pool = require('./src/config/database');
const initializeDatabase = require('./src/config/initializeDatabase');

// Route imports
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/products');
const orderRoutes = require('./src/routes/orders');
const dashboardRoutes = require('./src/routes/dashboard');
const paymentRoutes = require('./src/routes/payments');

const app = express();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  // GitHub Pages frontend — set FRONTEND_URL in Render env vars
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    message: 'FarmBridge API is running',
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', paymentRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Retry DB initialization up to maxAttempts times, waiting delaySec between tries.
const initDatabaseWithRetry = async (maxAttempts = 5, delaySec = 5) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initializeDatabase();
      const connection = await pool.getConnection();
      console.log('✅ Database connected successfully');
      connection.release();
      return true;
    } catch (err) {
      const msg = err && (err.message || String(err));
      console.error(`❌ Database connection attempt ${attempt}/${maxAttempts} failed: ${msg}`);
      if (attempt < maxAttempts) {
        console.log(`⏳ Retrying in ${delaySec}s...`);
        await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
      }
    }
  }
  console.error('❌ Could not connect to the database after all attempts. Check your DB_* environment variables on Render.');
  return false;
};

// Bind the HTTP port first so Render's port scan succeeds,
// then initialise the database in the background.
app.listen(PORT, () => {
  console.log(`🚀 FarmBridge API server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);

  initDatabaseWithRetry().then((ok) => {
    if (!ok) {
      console.error('⚠️  Server is running but the database is unavailable. API calls requiring DB will fail.');
    }
  });
});

module.exports = app;
