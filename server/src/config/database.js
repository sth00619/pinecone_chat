// server/src/config/database.js
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

// 테스트 환경에서는 로깅 최소화
if (process.env.NODE_ENV !== 'test') {
  console.log('Database config:', {
    ...config,
    password: '***' // 비밀번호는 숨김
  });
}

const pool = mysql.createPool(config);

// 테스트 환경이 아닐 때만 연결 테스트 실행
if (process.env.NODE_ENV !== 'test') {
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
}

// 풀 종료 함수 추가
pool.closeAll = async () => {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
};

module.exports = pool;