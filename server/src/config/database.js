const mysql = require('mysql2/promise');
require('dotenv').config();

// IPv6 연결 문제 해결을 위해 명시적으로 127.0.0.1 사용
const pool = mysql.createPool({
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // 추가 옵션
  connectTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;
