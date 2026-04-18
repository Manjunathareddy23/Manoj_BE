const express = require('express');
const multer = require('multer');
const {
  getAllProducts,
  getProduct,
  addProduct,
  getFarmerProducts,
  searchProducts,
  deleteProduct,
} = require('../controllers/productController');
const { authenticateToken, checkRole } = require('../middleware/auth');

const router = express.Router();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Public routes
router.get('/', getAllProducts);
router.get('/search', searchProducts);
router.get('/:id', getProduct);

// Protected routes
router.post('/', authenticateToken, checkRole(['farmer']), upload.single('image'), addProduct);
router.get('/farmer/my-products', authenticateToken, checkRole(['farmer']), getFarmerProducts);
router.delete('/:id', authenticateToken, checkRole(['farmer']), deleteProduct);

module.exports = router;
