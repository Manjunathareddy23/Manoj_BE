const mysql = require('mysql2/promise');
require('dotenv').config();

// Resolve connection parameters using priority order:
//   1. MYSQL_ADDON_URI  — Clever Cloud canonical URI (highest priority)
//   2. MYSQL_ADDON_*    — Clever Cloud individual variables
//   3. DB_*             — local / custom variables (lowest priority)
//
// This prevents DB_HOST=localhost (a local-dev override) from shadowing
// a real cloud database when both sets of variables exist on Render.
let dbHost, dbUser, dbPassword, dbName, dbPort, isCloudDb;

if (process.env.MYSQL_ADDON_URI) {
  // Parse the URI:  mysql://user:pass@host:port/dbname
  try {
    const uri = new URL(process.env.MYSQL_ADDON_URI);
    dbHost     = uri.hostname;
    dbUser     = decodeURIComponent(uri.username);
    dbPassword = decodeURIComponent(uri.password);
    dbName     = uri.pathname.replace(/^\//, '');
    dbPort     = Number(uri.port) || 3306;
    isCloudDb  = true;
    console.log(`🔌 Using MYSQL_ADDON_URI to connect to ${dbHost}:${dbPort}/${dbName}`);
  } catch (e) {
    console.error('❌ Failed to parse MYSQL_ADDON_URI:', e.message);
  }
}

if (!dbHost && process.env.MYSQL_ADDON_HOST) {
  dbHost     = process.env.MYSQL_ADDON_HOST;
  dbUser     = process.env.MYSQL_ADDON_USER;
  dbPassword = process.env.MYSQL_ADDON_PASSWORD;
  dbName     = process.env.MYSQL_ADDON_DB;
  dbPort     = Number(process.env.MYSQL_ADDON_PORT) || 3306;
  isCloudDb  = true;
  console.log(`🔌 Using MYSQL_ADDON_* to connect to ${dbHost}:${dbPort}/${dbName}`);
}

if (!dbHost) {
  dbHost     = process.env.DB_HOST;
  dbUser     = process.env.DB_USER;
  dbPassword = process.env.DB_PASSWORD;
  dbName     = process.env.DB_NAME;
  dbPort     = Number(process.env.DB_PORT) || 3306;
  isCloudDb  = dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1';
  console.log(`🔌 Using DB_* to connect to ${dbHost}:${dbPort}/${dbName}`);
}

if (!dbHost || !dbUser || !dbName) {
  console.error(
    '❌ Database configuration is incomplete. ' +
    'Set MYSQL_ADDON_URI (or MYSQL_ADDON_HOST/USER/PASSWORD/DB) on Render, ' +
    'or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME for local development.'
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
  // Always use SSL for remote cloud databases (Clever Cloud, Railway, etc.).
  // rejectUnauthorized:false is required because these providers use private CAs.
  ...(isCloudDb && {
    ssl: { rejectUnauthorized: false }
  }),
};

const pool = mysql.createPool(poolConfig);

module.exports = pool;
