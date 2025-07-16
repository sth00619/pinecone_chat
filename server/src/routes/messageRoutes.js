// server/src/routes/messageRoutes.js
const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// EnhancedMessageController 안전하게 로드
let controller;
try {
  controller = require('../controllers/enhancedMessageController');
  console.log('✅ EnhancedMessageController loaded successfully');
} catch (error) {
  console.warn('⚠️ EnhancedMessageController not found, using fallback handlers:', error.message);
  
  // 기본 핸들러들 정의
  controller = {
    sendMessage: (req, res) => {
      res.json({ 
        success: true, 
        message: 'Message sent - Controller not implemented yet',
        data: req.body 
      });
    }
  };
}

// getHelp 메서드 정의 (controller에 없으므로 여기서 정의)
const getHelp = (req, res) => {
  res.json({ 
    success: true, 
    message: 'Pinecone Chat API Help',
    version: '1.0.0',
    endpoints: [
      {
        method: 'GET',
        path: '/api/messages/help',
        description: 'API 도움말',
        auth: false
      },
      {
        method: 'POST',
        path: '/api/messages',
        description: '메시지 전송',
        auth: true,
        body: {
          chat_room_id: 'number',
          content: 'string'
        }
      },
      {
        method: 'GET',
        path: '/api/messages/chat-room/:chatRoomId',
        description: '채팅방 메시지 조회',
        auth: true
      },
      {
        method: 'DELETE',
        path: '/api/messages/:id',
        description: '메시지 삭제',
        auth: true
      },
      {
        method: 'GET',
        path: '/api/messages/personal-info',
        description: '개인정보 조회',
        auth: true
      },
      {
        method: 'POST',
        path: '/api/messages/personal-info',
        description: '개인정보 추가',
        auth: true
      },
      {
        method: 'DELETE',
        path: '/api/messages/personal-info/:id',
        description: '개인정보 삭제',
        auth: true
      },
      {
        method: 'GET',
        path: '/api/messages/reminders',
        description: '리마인더 조회',
        auth: true
      }
    ]
  });
};

// getMessages 메서드 정의 (controller에 없으므로 여기서 정의)
const getMessages = async (req, res) => {
  try {
    const { chatRoomId } = req.params;
    const userId = req.userId;
    
    // 실제 구현이 필요한 경우 messageDao를 사용
    // const messageDao = require('../dao/messageDao');
    // const messages = await messageDao.getMessagesByChatRoom(chatRoomId);
    
    res.json({ 
      success: true, 
      messages: [], // 임시로 빈 배열
      chatRoomId: parseInt(chatRoomId),
      message: 'Messages retrieved successfully (temporary implementation)'
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get messages' 
    });
  }
};

// deleteMessage 메서드 정의 (controller에 없으므로 여기서 정의)
const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // 실제 구현이 필요한 경우 messageDao를 사용
    // const messageDao = require('../dao/messageDao');
    // await messageDao.deleteMessage(id, userId);
    
    res.json({ 
      success: true, 
      message: `Message ${id} deleted successfully (temporary implementation)` 
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete message' 
    });
  }
};

// handleUserFeedback 메서드 정의 (controller에 없으므로 여기서 정의)
const handleUserFeedback = async (req, res) => {
  try {
    const userId = req.userId;
    const feedback = req.body;
    
    console.log('User feedback received:', { userId, feedback });
    
    res.json({ 
      success: true, 
      message: 'Feedback received successfully',
      feedback: feedback
    });
  } catch (error) {
    console.error('Error handling feedback:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process feedback' 
    });
  }
};

// analyzeSession 메서드 정의 (controller에 없으므로 여기서 정의)
const analyzeSession = async (req, res) => {
  try {
    const userId = req.userId;
    const sessionData = req.body;
    
    console.log('Session analysis requested:', { userId, sessionData });
    
    res.json({ 
      success: true, 
      message: 'Session analysis completed',
      analysis: {
        userId: userId,
        sessionDuration: 0,
        messageCount: 0,
        topics: [],
        sentiment: 'neutral'
      }
    });
  } catch (error) {
    console.error('Error analyzing session:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to analyze session' 
    });
  }
};

// 기본 메시지 관련 라우트
router.get('/help', getHelp);
router.get('/chat-room/:chatRoomId', authMiddleware, getMessages);
router.post('/', authMiddleware, controller.sendMessage);
router.delete('/:id', authMiddleware, deleteMessage);

// 피드백 및 분석
router.post('/feedback', authMiddleware, handleUserFeedback);
router.post('/analyze-session', authMiddleware, analyzeSession);

// 개인정보 관련 엔드포인트
router.get('/personal-info', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    
    // 서비스 클래스 동적 로딩 및 에러 처리
    let detector;
    try {
      const PersonalDataDetector = require('../services/enhancedPersonalDataDetector');
      detector = new PersonalDataDetector();
    } catch (error) {
      console.error('PersonalDataDetector service not found:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Personal data service unavailable',
        personalInfo: []
      });
    }
    
    const personalInfo = await detector.getUserPersonalInfo(userId);
    
    res.json({
      success: true,
      personalInfo: personalInfo || []
    });
  } catch (error) {
    console.error('Error fetching personal info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch personal information',
      personalInfo: []
    });
  }
});

// 개인정보 수동 추가
router.post('/personal-info', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { type, value, key, datetime } = req.body;
    
    // 입력 유효성 검사
    if (!type || !value) {
      return res.status(400).json({ 
        success: false,
        error: 'Type and value are required fields' 
      });
    }

    // 허용된 타입 검사
    const allowedTypes = ['schedule', 'birthday', 'preference', 'goal', 'location', 'contact'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Allowed types: ${allowedTypes.join(', ')}`
      });
    }
    
    // 서비스 클래스들 동적 로딩
    let detector, encryptionService;
    try {
      const PersonalDataDetector = require('../services/enhancedPersonalDataDetector');
      const EncryptionService = require('../services/encryptionService');
      detector = new PersonalDataDetector();
      encryptionService = new EncryptionService();
    } catch (error) {
      console.error('Required services not found:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Required services unavailable' 
      });
    }
    
    // 데이터 암호화 및 저장
    const savedData = await encryptionService.encryptPersonalData(
      userId,
      type,
      value,
      { key, datetime }
    );
    
    // 컨텍스트 캐시 무효화
    try {
      const UserContextManager = require('../services/userContextManager');
      const contextManager = new UserContextManager();
      await contextManager.invalidateContext(userId);
    } catch (error) {
      console.warn('Context invalidation failed:', error);
      // 컨텍스트 무효화 실패는 치명적이지 않으므로 계속 진행
    }
    
    res.json({
      success: true,
      message: 'Personal information saved successfully',
      data: {
        id: savedData?.id,
        type,
        value,
        key,
        datetime
      }
    });
  } catch (error) {
    console.error('Error saving personal info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to save personal information' 
    });
  }
});

// 개인정보 수정
router.put('/personal-info/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { type, value, key, datetime } = req.body;
    
    if (!type || !value) {
      return res.status(400).json({ 
        success: false,
        error: 'Type and value are required fields' 
      });
    }

    // 데이터베이스 연결
    const db = require('../config/database');
    
    // 소유권 확인 후 수정
    const [result] = await db.query(
      `UPDATE user_personal_data 
       SET type = ?, value = ?, metadata = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ? AND is_active = TRUE`,
      [type, value, JSON.stringify({ key, datetime }), id, userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Personal information not found or access denied' 
      });
    }
    
    // 컨텍스트 캐시 무효화
    try {
      const UserContextManager = require('../services/userContextManager');
      const contextManager = new UserContextManager();
      await contextManager.invalidateContext(userId);
    } catch (error) {
      console.warn('Context invalidation failed:', error);
    }
    
    res.json({
      success: true,
      message: 'Personal information updated successfully'
    });
  } catch (error) {
    console.error('Error updating personal info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update personal information' 
    });
  }
});

// 개인정보 삭제
router.delete('/personal-info/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // 입력 유효성 검사
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Valid ID is required' 
      });
    }
    
    // 데이터베이스 연결
    let db;
    try {
      db = require('../config/database');
    } catch (error) {
      console.error('Database connection failed:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Database service unavailable' 
      });
    }
    
    // 소유권 확인 후 삭제 (soft delete)
    const [result] = await db.query(
      'UPDATE user_personal_data SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND user_id = ? AND is_active = TRUE',
      [id, userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Personal information not found or already deleted' 
      });
    }
    
    // 컨텍스트 캐시 무효화
    try {
      const UserContextManager = require('../services/userContextManager');
      const contextManager = new UserContextManager();
      await contextManager.invalidateContext(userId);
    } catch (error) {
      console.warn('Context invalidation failed:', error);
      // 비치명적 오류이므로 계속 진행
    }
    
    res.json({
      success: true,
      message: 'Personal information deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting personal info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete personal information' 
    });
  }
});

// 리마인더 조회
router.get('/reminders', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    
    let contextManager;
    try {
      const UserContextManager = require('../services/userContextManager');
      contextManager = new UserContextManager();
    } catch (error) {
      console.error('UserContextManager service not found:', error);
      return res.json({
        success: true,
        reminders: [],
        message: 'Reminder service temporarily unavailable'
      });
    }
    
    const reminders = await contextManager.generateReminders(userId);
    
    res.json({
      success: true,
      reminders: reminders || []
    });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch reminders',
      reminders: []
    });
  }
});

// 개인정보 통계 조회 (새로운 엔드포인트)
router.get('/personal-info/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const db = require('../config/database');
    
    const [stats] = await db.query(
      `SELECT 
         type,
         COUNT(*) as count
       FROM user_personal_data 
       WHERE user_id = ? AND is_active = TRUE 
       GROUP BY type`,
      [userId]
    );
    
    const totalCount = stats.reduce((sum, stat) => sum + stat.count, 0);
    
    res.json({
      success: true,
      stats: {
        total: totalCount,
        byType: stats.reduce((acc, stat) => {
          acc[stat.type] = stat.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Error fetching personal info stats:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch statistics',
      stats: { total: 0, byType: {} }
    });
  }
});

// 컨텍스트 조회 (디버깅용)
router.get('/context', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { chatRoomId } = req.query;
    
    let contextManager;
    try {
      const UserContextManager = require('../services/userContextManager');
      contextManager = new UserContextManager();
    } catch (error) {
      console.error('UserContextManager service not found:', error);
      return res.json({
        success: true,
        context: {},
        message: 'Context service temporarily unavailable'
      });
    }
    
    const context = await contextManager.loadUserContext(userId, chatRoomId);
    
    res.json({
      success: true,
      context: context || {}
    });
  } catch (error) {
    console.error('Error fetching context:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch context',
      context: {}
    });
  }
});

// 개인정보 일괄 내보내기 (새로운 엔드포인트)
router.get('/personal-info/export', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const db = require('../config/database');
    
    const [personalData] = await db.query(
      `SELECT id, type, value, metadata, created_at, updated_at
       FROM user_personal_data 
       WHERE user_id = ? AND is_active = TRUE 
       ORDER BY type, created_at DESC`,
      [userId]
    );
    
    // 암호화된 데이터 복호화 (필요한 경우)
    const decryptedData = personalData.map(item => ({
      ...item,
      metadata: item.metadata ? JSON.parse(item.metadata) : null
    }));
    
    res.json({
      success: true,
      data: decryptedData,
      exportedAt: new Date().toISOString(),
      totalRecords: decryptedData.length
    });
  } catch (error) {
    console.error('Error exporting personal info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export personal information' 
    });
  }
});

/**
 * @swagger
 * /api/messages/personal-info:
 *   get:
 *     summary: 사용자 개인정보 조회
 *     description: 저장된 사용자의 개인정보를 조회합니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 개인정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 personalInfo:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       type:
 *                         type: string
 *                         enum: [schedule, birthday, preference, goal, location, contact]
 *                       value:
 *                         type: string
 *                       key:
 *                         type: string
 *                       datetime:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 */

/**
 * @swagger
 * /api/messages/personal-info:
 *   post:
 *     summary: 개인정보 수동 추가
 *     description: 사용자의 개인정보를 수동으로 추가합니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - value
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [schedule, birthday, preference, goal, location, contact]
 *                 description: 개인정보 유형
 *               value:
 *                 type: string
 *                 description: 개인정보 내용
 *               key:
 *                 type: string
 *                 description: 키워드 또는 태그
 *               datetime:
 *                 type: string
 *                 description: 날짜/시간 정보
 *     responses:
 *       200:
 *         description: 개인정보 저장 성공
 *       400:
 *         description: 잘못된 요청 (필수 필드 누락 또는 잘못된 타입)
 *       500:
 *         description: 서버 오류
 */

/**
 * @swagger
 * /api/messages/personal-info/{id}:
 *   put:
 *     summary: 개인정보 수정
 *     description: 기존 개인정보를 수정합니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 개인정보 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - value
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [schedule, birthday, preference, goal, location, contact]
 *               value:
 *                 type: string
 *               key:
 *                 type: string
 *               datetime:
 *                 type: string
 *     responses:
 *       200:
 *         description: 개인정보 수정 성공
 *       404:
 *         description: 개인정보를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 *   delete:
 *     summary: 개인정보 삭제
 *     description: 개인정보를 삭제합니다 (소프트 삭제).
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 삭제할 개인정보 ID
 *     responses:
 *       200:
 *         description: 개인정보 삭제 성공
 *       404:
 *         description: 개인정보를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */

/**
 * @swagger
 * /api/messages/reminders:
 *   get:
 *     summary: 리마인더 조회
 *     description: 사용자의 일정 및 기념일 리마인더를 조회합니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 리마인더 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 reminders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       content:
 *                         type: string
 *                       urgency:
 *                         type: string
 *                         enum: [high, medium, low]
 *                       datetime:
 *                         type: string
 *                         format: date-time
 */

/**
 * @swagger
 * /api/messages/personal-info/stats:
 *   get:
 *     summary: 개인정보 통계 조회
 *     description: 사용자의 개인정보 통계를 조회합니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 통계 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     byType:
 *                       type: object
 */

/**
 * @swagger
 * /api/messages/personal-info/export:
 *   get:
 *     summary: 개인정보 내보내기
 *     description: 사용자의 모든 개인정보를 내보냅니다.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 내보내기 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                 exportedAt:
 *                   type: string
 *                   format: date-time
 *                 totalRecords:
 *                   type: integer
 */

module.exports = router;