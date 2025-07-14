// server/src/setupTests.js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

let dbPool;
let poolClosed = false;

beforeAll(() => {
  dbPool = require('./config/database');
});

afterAll(async () => {
  if (dbPool && !poolClosed) {
    try {
      // 연결이 열려있는지 확인
      const connection = await dbPool.getConnection();
      connection.release();
      
      // 연결이 열려있으면 종료
      await dbPool.end();
      poolClosed = true;
      console.log('Database pool closed in tests');
    } catch (error) {
      // 이미 닫혀있거나 연결할 수 없는 경우
      if (error.message.includes('closed state')) {
        console.log('Database pool already closed');
      } else {
        console.error('Error closing database pool:', error.message);
      }
    }
  }
  
  jest.clearAllTimers();
  await new Promise(resolve => setTimeout(resolve, 100));
});

jest.setTimeout(30000);