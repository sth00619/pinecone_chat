// server/src/routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();
const EnhancedMessageController = require('../controllers/enhancedMessageController');
const authMiddleware = require('../middleware/authMiddleware');

const messageController = new EnhancedMessageController();

// 모든 라우트에 인증 미들웨어 적용
router.use(authMiddleware);

// 사용자 일정 조회
router.get('/schedules', async (req, res) => {
  await messageController.getUserSchedules(req, res);
});

// 일정 삭제
router.delete('/schedules/:scheduleId', async (req, res) => {
  await messageController.deleteSchedule(req, res);
});

// 일정 업데이트
router.put('/schedules/:scheduleId', async (req, res) => {
  await messageController.updateSchedule(req, res);
});

// 일정 검색/조회
router.post('/schedules/search', async (req, res) => {
  try {
    const { query } = req.body;
    const userId = req.user.userId;
    
    const detector = new (require('../services/enhancedPersonalDataDetector'))();
    const result = await detector.interpretScheduleQuery(query, userId);
    
    res.json({
      success: true,
      queryType: result.queryType,
      schedules: result.relevantSchedules,
      hasMatches: result.hasMatches
    });
    
  } catch (error) {
    console.error('Error searching schedules:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;