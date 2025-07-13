// jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/server/src/setupTests.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/node_modules/**',
    '!server/**/__tests__/**',
    '!server/**/setupTests.js'
  ],
  testMatch: [
    '**/server/**/__tests__/**/*.test.js',
    '**/server/**/*.test.js',
    '**/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/basic.test.js'
  ],
  moduleDirectories: ['node_modules', 'server'],
  verbose: true,
  testTimeout: 30000,
  testSequencer: '<rootDir>/testSequencer.js',
  globals: {
    DB_HOST: '127.0.0.1'
  },
  // 열린 핸들 감지
  detectOpenHandles: true,
  // 테스트 완료 후 강제 종료 (최후의 수단)
  forceExit: true,
  // 최대 워커 수 제한
  maxWorkers: 1
};