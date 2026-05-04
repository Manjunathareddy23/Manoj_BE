const mysql = require('mysql2/promise');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const poolConfig = {
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Cloud databases (Clever Cloud, PlanetScale, etc.) require SSL
  // rejectUnauthorized: false allows self-signed certs used by most cloud providers
  ...(isProduction && {
    ssl: { rejectUnauthorized: false }
  }),
};

const pool = mysql.createPool(poolConfig);

module.exports = pool;
