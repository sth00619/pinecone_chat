// tests/basic.test.js
const request = require('supertest');
const { app, server } = require('../app');

describe('Basic API Tests', () => {
  let testServer;
  
  // 테스트 전에 서버 시작
  beforeAll((done) => {
    // 이미 서버가 실행 중인 경우 그대로 사용, 아니면 새로 시작
    if (server && server.listening) {
      testServer = server;
      done();
    } else {
      testServer = app.listen(0, () => {
        done();
      });
    }
  });

  // 테스트 후 서버 종료
  afterAll((done) => {
    if (testServer && testServer !== server) {
      testServer.close(done);
    } else {
      done();
    }
  });

  describe('Health Check Endpoints', () => {
    test('GET /health should return 200 with OK status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('service', 'SeoulTech Chat API');
    });
  });

  describe('Root Endpoint', () => {
    test('GET / should return API information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('message', '🚀 SeoulTech Chat API Server');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body.endpoints).toHaveProperty('docs', '/api-docs');
      expect(response.body.endpoints).toHaveProperty('health', '/health');
    });
  });

  describe('404 Handler', () => {
    test('GET /unknown-route should return 404', async () => {
      const response = await request(app)
        .get('/unknown-route')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Route not found');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Cannot GET /unknown-route');
    });

    test('POST /another-unknown-route should return 404', async () => {
      const response = await request(app)
        .post('/another-unknown-route')
        .send({ test: 'data' })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Route not found');
      expect(response.body).toHaveProperty('suggestion', 'Try /api-docs for API documentation');
    });
  });

  describe('API Routes Structure', () => {
    test('API routes should be prefixed with /api', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      const { endpoints } = response.body;
      expect(endpoints.auth).toMatch(/^\/api\//);
      expect(endpoints.users).toMatch(/^\/api\//);
      expect(endpoints.chatRooms).toMatch(/^\/api\//);
      expect(endpoints.messages).toMatch(/^\/api\//);
    });
  });

  describe('CORS Configuration', () => {
    test('Should have CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // CORS 헤더 확인
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Content-Type', () => {
    test('Should return JSON content type', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});

// 만약 이 파일을 직접 실행하는 경우를 위한 처리
if (require.main === module) {
  // Jest가 아닌 직접 실행인 경우
  console.log('Running basic tests directly...');
  
  const runDirectTests = async () => {
    const testApp = require('../app').app;
    const testServer = testApp.listen(0);
    const port = testServer.address().port;
    
    try {
      console.log(`Test server running on port ${port}`);
      
      // 간단한 health check
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.status === 200) {
        console.log('✅ Health check passed');
      } else {
        console.log('❌ Health check failed');
      }
      
      console.log('Direct tests completed');
    } catch (error) {
      console.error('Test error:', error);
    } finally {
      testServer.close();
    }
  };
  
  runDirectTests().catch(console.error);
}