// app.js
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const http = require('http');
const WebSocketServer = require('./server/src/websocket/wsServer');
require('dotenv').config();

// Express 앱 생성 (가장 먼저!)
const app = express();

// HTTP 서버 생성
const server = http.createServer(app);

// WebSocket 서버 초기화
const wsServer = new WebSocketServer(server);
// WebSocket 인스턴스를 전역적으로 사용할 수 있도록 설정
app.set('wsServer', wsServer);

// Passport 초기화
const initializePassport = require('./server/src/config/passport');
initializePassport();

// 학습 스케줄러 (선택적 로딩)
let learningScheduler;
try {
  learningScheduler = require('./server/src/schedulers/learningScheduler');
} catch (error) {
  console.warn('Learning scheduler not found, continuing without it');
}

// 라우트 import
const userRoutes = require('./server/src/routes/userRoutes');
const authRoutes = require('./server/src/routes/authRoutes');
const chatRoutes = require('./server/src/routes/chatRoutes');
const messageRoutes = require('./server/src/routes/messageRoutes');
const pineconeRoutes = require('./server/src/routes/pineconeRoutes');
const errorHandler = require('./server/src/middleware/errorHandler');

// 미들웨어 설정
app.use(cors({
  origin: 'http://localhost:3001',
  credentials: true
}));
app.use(express.json());

// 세션 설정 (Passport에 필요)
app.use(session({
  secret: process.env.SESSION_SECRET || 'seoultech-chat-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // HTTPS에서는 true로 설정
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24시간
  }
}));

// Passport 미들웨어
app.use(passport.initialize());
app.use(passport.session());

// Swagger 설정
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'SeoulTech Chat API',
      version: '1.0.0',
      description: 'API for SeoulTech Chat Application',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./server/src/routes/*.js'],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// API 정보 페이지 (루트)
app.get('/', (req, res) => {
  res.json({
    message: '🚀 SeoulTech Chat API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      docs: '/api-docs',
      health: '/health',
      auth: '/api/auth',
      users: '/api/users',
      chatRooms: '/api/chat-rooms',
      messages: '/api/messages',
      pinecone: '/api/pinecone'
    },
    frontend: 'http://localhost:3001',
    note: 'React 앱은 http://localhost:3001에서 실행 중입니다.'
  });
});

// API 라우트 설정
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat-rooms', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/pinecone', pineconeRoutes);

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'SeoulTech Chat API'
  });
});

// 404 핸들러
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    suggestion: 'Try /api-docs for API documentation'
  });
});

// 에러 핸들러
app.use(errorHandler);

// 서버 시작
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('🚀=================================🚀');
    console.log(`   SeoulTech Chat API Server       `);
    console.log('🚀=================================🚀');
    console.log(`🌐 API Server: http://localhost:${PORT}`);
    console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
    console.log(`💊 Health Check: http://localhost:${PORT}/health`);
    console.log(`📱 React App: http://localhost:3001`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('🚀=================================🚀');
    
    // 학습 스케줄러 시작 (있는 경우에만)
    if (learningScheduler) {
      try {
        learningScheduler.start();
        console.log('✅ Learning scheduler started successfully');
      } catch (error) {
        console.error('Failed to start learning scheduler:', error);
      }
    }
  });
}

// 우아한 종료 처리
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (learningScheduler) {
    learningScheduler.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  if (learningScheduler) {
    learningScheduler.stop();
  }
  process.exit(0);
});

module.exports = { app, server };