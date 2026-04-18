const pool = require('../config/database');

// Get All Products
const getAllProducts = async (req, res) => {
  try {
    const [products] = await pool.query(
      'SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id'
    );

    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
};

// Get Single Product
const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const [products] = await pool.query(
      'SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = ?',
      [id]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(products[0]);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
};

// Add Product
const addProduct = async (req, res) => {
  try {
    const { name, price, bags, weight_per_bag, description } = req.body;
    const farmerId = req.user.id;

    // Validate required fields
    if (!name || !price || !bags || !weight_per_bag) {
      return res.status(400).json({ 
        message: 'Missing required fields: name, price, bags, weight_per_bag' 
      });
    }

    // Convert to proper types
    const parsedPrice = parseFloat(price);
    const parsedBags = parseInt(bags);
    const parsedWeightPerBag = parseFloat(weight_per_bag);

    if (isNaN(parsedPrice) || isNaN(parsedBags) || isNaN(parsedWeightPerBag)) {
      return res.status(400).json({ 
        message: 'Invalid number format for price, bags, or weight_per_bag' 
      });
    }

    const total_weight = parsedBags * parsedWeightPerBag;

    // Convert image to base64 if provided
    let imageBase64 = null;
    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    }

    const [result] = await pool.query(
      'INSERT INTO products (farmer_id, name, price, bags, weight_per_bag, total_weight, description, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [farmerId, name, parsedPrice, parsedBags, parsedWeightPerBag, total_weight, description || '', imageBase64]
    );

    res.status(201).json({
      message: 'Product added successfully',
      productId: result.insertId,
    });
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({ message: 'Add failed', error: error.message });
  }
};

// Get Farmer Products
const getFarmerProducts = async (req, res) => {
  try {
    const farmerId = req.user.id;

    const [products] = await pool.query(
      'SELECT * FROM products WHERE farmer_id = ?',
      [farmerId]
    );

    res.json(products);
  } catch (error) {
    console.error('Error fetching farmer products:', error);
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
};

// Search Products
const searchProducts = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const [products] = await pool.query(
      'SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.name LIKE ? OR p.description LIKE ?',
      [`%${q}%`, `%${q}%`]
    );

    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ message: 'Search failed', error: error.message });
  }
};

// Delete Product
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      'DELETE FROM products WHERE id = ? AND farmer_id = ?',
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found or unauthorized' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Delete failed' });
  }
};

module.exports = {
  getAllProducts,
  getProduct,
  addProduct,
  getFarmerProducts,
  searchProducts,
  deleteProduct,
};
