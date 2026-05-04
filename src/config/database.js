const mysql = require('mysql2/promise');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Support both local DB_* variables and Clever Cloud MYSQL_ADDON_* variables
const dbHost     = process.env.DB_HOST     || process.env.MYSQL_ADDON_HOST;
const dbUser     = process.env.DB_USER     || process.env.MYSQL_ADDON_USER;
const dbPassword = process.env.DB_PASSWORD || process.env.MYSQL_ADDON_PASSWORD;
const dbName     = process.env.DB_NAME     || process.env.MYSQL_ADDON_DB;
const dbPort     = Number(process.env.DB_PORT || process.env.MYSQL_ADDON_PORT) || 3306;

if (!dbHost || !dbUser || !dbName) {
  console.error(
    '❌ Database configuration is incomplete. Please set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME ' +
    '(or MYSQL_ADDON_HOST, MYSQL_ADDON_USER, MYSQL_ADDON_PASSWORD, MYSQL_ADDON_DB for Clever Cloud) ' +
    'in your environment variables.'
  );
}

const poolConfig = {
  host:     dbHost,
  user:     dbUser,
  password: dbPassword,
  database: dbName,
  port:     dbPort,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Enable SSL for cloud databases (PlanetScale, Railway, etc.)
  ...(isProduction && {
    ssl: { rejectUnauthorized: true }
  }),
};

const pool = mysql.createPool(poolConfig);

module.exports = pool;
