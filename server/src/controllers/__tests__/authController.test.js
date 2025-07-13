const request = require('supertest');
const express = require('express');
const authController = require('../authController');
const userDao = require('../../dao/userDao');
const bcrypt = require('bcryptjs');
const pool = require('../../config/database');

// Mock 설정
jest.mock('../../dao/userDao');
jest.mock('bcryptjs');

const app = express();
app.use(express.json());
app.post('/login', authController.login);
app.post('/register', authController.register);

describe('AuthController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });  
  
  // 테스트 스위트 종료 시 정리
  afterAll(async () => {
    // 이 테스트 파일에서 사용한 리소스 정리
    jest.restoreAllMocks();
  });

  describe('POST /login', () => {
    it('성공적인 로그인', async () => {
      const mockUser = {
        id: 1,
        email: 'test@seoultech.ac.kr',
        username: 'testuser',
        password: 'hashedPassword'
      };

      userDao.getUserByEmail.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const response = await request(app)
        .post('/login')
        .send({
          email: 'test@seoultech.ac.kr',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@seoultech.ac.kr');
    });

    it('잘못된 비밀번호로 로그인 실패', async () => {
      const mockUser = {
        id: 1,
        email: 'test@seoultech.ac.kr',
        password: 'hashedPassword'
      };

      userDao.getUserByEmail.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      const response = await request(app)
        .post('/login')
        .send({
          email: 'test@seoultech.ac.kr',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });
  });

  describe('POST /register', () => {
    it('새 사용자 등록 성공', async () => {
      userDao.getUserByEmail.mockResolvedValue(null);
      userDao.createUser.mockResolvedValue(1);
      bcrypt.hash.mockResolvedValue('hashedPassword');

      const response = await request(app)
        .post('/register')
        .send({
          email: 'new@seoultech.ac.kr',
          username: 'newuser',
          password: 'password123'
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('User created successfully');
      expect(userDao.createUser).toHaveBeenCalledWith({
        email: 'new@seoultech.ac.kr',
        username: 'newuser',
        password_hash: 'hashedPassword'
      });
    });
  });
});