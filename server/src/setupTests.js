// server/src/setupTests.js
// 테스트 환경 설정
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// Node.js 환경에서 TextEncoder/TextDecoder 설정
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// 데이터베이스 풀 관리
let dbPool;

beforeAll(() => {
  // 데이터베이스 풀 참조 저장
  dbPool = require('./config/database');
});

// 모든 테스트 완료 후 정리
afterAll(async () => {
  // 데이터베이스 연결 종료
  if (dbPool && typeof dbPool.end === 'function') {
    try {
      await dbPool.end();
      console.log('Database pool closed in tests');
    } catch (error) {
      console.error('Error closing database pool:', error);
    }
  }
  
  // 모든 타이머 정리
  jest.clearAllTimers();
  
  // 1초 대기 후 종료 (비동기 작업 완료 대기)
  await new Promise(resolve => setTimeout(resolve, 1000));
});

// 전역 타임아웃 설정
jest.setTimeout(30000);

// 콘솔 로그 숨기기 (선택사항)
if (process.env.HIDE_CONSOLE_LOGS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}