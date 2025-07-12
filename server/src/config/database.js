const mysql = require('mysql2/promise');
require('dotenv').config();

// 연결 설정
const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root123',
  database: process.env.DB_NAME || 'api_test',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

console.log('Database config:', {
  ...config,
  password: '***' // 비밀번호는 숨김
});

const pool = mysql.createPool(config);

// 연결 테스트
pool.getConnection()
  .then(connection => {
    console.log('✅ Database pool connected successfully!');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database pool connection failed:', err.message);
    console.error('Error details:', {
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState
    });
  });

module.exports = pool;