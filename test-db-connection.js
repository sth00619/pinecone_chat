require('dotenv').config();

console.log('Environment variables:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
console.log('DB_PASSWORD length:', process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 0);
console.log('DB_NAME:', process.env.DB_NAME);

const mysql = require('mysql2/promise');

async function testConnection() {
  // XAMPP 기본 포트로 테스트
  const configs = [
    {
      name: 'localhost with password',
      host: 'localhost',
      user: 'root',
      password: 'root123',
      database: 'api_test',
      port: 3306
    },
    {
      name: '127.0.0.1 with password',
      host: '127.0.0.1',
      user: 'root',
      password: 'root123',
      database: 'api_test',
      port: 3306
    },
    {
      name: 'localhost without port',
      host: 'localhost',
      user: 'root',
      password: 'root123',
      database: 'api_test'
    }
  ];

  for (const config of configs) {
    try {
      console.log(`\n--- Testing: ${config.name} ---`);
      const conn = await mysql.createConnection(config);
      console.log('✅ Connected successfully!');
      
      // 연결 정보 확인
      const [rows] = await conn.execute('SELECT CONNECTION_ID() as id, DATABASE() as db');
      console.log('Connection info:', rows[0]);
      
      await conn.end();
    } catch (err) {
      console.error('❌ Failed:', err.message);
      if (err.errno) {
        console.error('Error code:', err.errno);
        console.error('SQL State:', err.sqlState);
      }
    }
  }
}

// 서비스 상태 확인
const { exec } = require('child_process');

console.log('\n--- Checking MySQL/MariaDB Service ---');
exec('netstat -an | findstr :3306', (error, stdout, stderr) => {
  if (stdout) {
    console.log('Port 3306 status:');
    console.log(stdout);
  } else {
    console.log('⚠️  Port 3306 not found - MySQL/MariaDB might not be running');
  }
  
  // 연결 테스트 실행
  testConnection();
});