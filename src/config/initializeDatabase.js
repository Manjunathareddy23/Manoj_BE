const pool = require('./database');

const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();

    // Create users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        google_id VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role ENUM('farmer', 'consumer') NOT NULL,
        phone VARCHAR(20),
        whatsapp VARCHAR(20),
        place VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        zipcode VARCHAR(10),
        profile_image LONGBLOB,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Create products table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        farmer_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        weight_per_bag INT,
        bags INT DEFAULT 0,
        total_weight DECIMAL(10, 2),
        unit VARCHAR(50),
        category VARCHAR(100),
        image LONGBLOB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create orders table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        consumer_id INT NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(50),
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        delivery_address TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        customer_name VARCHAR(100),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(20),
        items JSON,
        rejection_reason TEXT,
        delivery_date TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (consumer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Add payment_status column if it doesn't exist (for existing databases)
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50) DEFAULT 'unpaid'`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Add rejection_reason column if it doesn't exist
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN rejection_reason TEXT`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Add delivery_date column if it doesn't exist
    try {
      await connection.query(`ALTER TABLE orders ADD COLUMN delivery_date TIMESTAMP NULL`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Add missing users columns if they don't exist (for existing databases)
    for (const alter of [
      // Add google_id without UNIQUE first to avoid failure if duplicates exist
      `ALTER TABLE users ADD COLUMN google_id VARCHAR(255)`,
      `ALTER TABLE users ADD COLUMN name VARCHAR(255)`,
      `ALTER TABLE users ADD COLUMN whatsapp VARCHAR(20)`,
      `ALTER TABLE users ADD COLUMN place VARCHAR(255)`,
    ]) {
      try {
        await connection.query(alter);
      } catch (err) {
        // ER_DUP_FIELDNAME (1060) = column already exists; safe to ignore
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }

    // Add unique index on google_id if it doesn't already exist
    try {
      await connection.query(`ALTER TABLE users ADD UNIQUE INDEX idx_google_id (google_id)`);
    } catch (err) {
      // ER_DUP_KEYNAME (1061) = index already exists; safe to ignore
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }

    // Add missing products columns if they don't exist (for existing databases)
    try {
      await connection.query(`ALTER TABLE products ADD COLUMN total_weight DECIMAL(10, 2)`);
    } catch (err) {
      // ER_DUP_FIELDNAME (1060) = column already exists; safe to ignore
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    connection.release();
    console.log('✅ Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    // Don't exit on error - tables might already exist
    return false;
  }
};

module.exports = initializeDatabase;
