// tests/integration/personalDataFlow.test.js
const request = require('supertest');
const { app } = require('../../app');
const jwt = require('jsonwebtoken');

describe('Personal Data Detection and Encryption Flow', () => {
    let authToken;
    let testUser;

    beforeAll(async () => {
      // 테스트용 유효한 JWT 토큰 생성
      testUser = { userId: 1, email: 'test@example.com' };
      authToken = jwt.sign(testUser, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
    });  
    test('Complete flow: detect → encrypt → store', async () => {
    // 1. 메시지 전송 (개인정보 포함)
      const messageResponse = await request(app)
        .post('/api/messages')
        .set('Authorization', 'Bearer test-token')
        .send({
          chat_room_id: 1,
          content: '내 이메일은 user@test.com 이고 전화번호는 010-1234-5678 입니다'
    });
    
    expect(messageResponse.status).toBe(201);
    
    // 2. 개인정보 감지 확인
    const logsResponse = await request(app)
      .get('/api/personal-data/logs')
      .set('Authorization', 'Bearer test-token');
    
    expect(logsResponse.body.logs).toHaveLength(2);
    expect(logsResponse.body.logs[0].data_type).toBe('email');
    expect(logsResponse.body.logs[1].data_type).toBe('phone');
    
    // 3. 암호화된 데이터 확인
    const encryptedResponse = await request(app)
      .get('/api/personal-data/encrypted')
      .set('Authorization', 'Bearer test-token');
    
    expect(encryptedResponse.body.data).toHaveLength(2);
  });
});