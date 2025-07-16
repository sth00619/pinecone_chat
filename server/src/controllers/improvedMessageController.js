// server/src/controllers/improvedMessageController.js
const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const ImprovedPersonalDataDetector = require('../services/ImprovedPersonalDataDetector');
const axios = require('axios');

class ImprovedMessageController {
  constructor() {
    try {
      console.log('🔧 Initializing ImprovedMessageController...');
      this.personalDataDetector = new ImprovedPersonalDataDetector();
      console.log('✅ PersonalDataDetector initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing PersonalDataDetector:', error);
      this.personalDataDetector = null;
    }
    
    // 메서드 바인딩
    this.sendMessage = this.sendMessage.bind(this);
    this.getMonthlySchedules = this.getMonthlySchedules.bind(this);
    this.handleBasicMessage = this.handleBasicMessage.bind(this);
  }

  async sendMessage(req, res) {
    try {
      console.log('📨 Enhanced sendMessage called with:', req.body);
      const startTime = Date.now();
      const { chat_room_id, content } = req.body;
      const userId = req.userId;

      // 입력 검증
      if (!chat_room_id || !content) {
        return res.status(400).json({ error: 'chat_room_id and content are required' });
      }

      // PersonalDataDetector 초기화 확인
      if (!this.personalDataDetector) {
        console.warn('⚠️ PersonalDataDetector not available, initializing fallback...');
        try {
          this.personalDataDetector = new ImprovedPersonalDataDetector();
        } catch (initError) {
          console.error('❌ Failed to initialize PersonalDataDetector:', initError);
          // 폴백 처리: 일정 기능 없이 기본 ChatGPT만 사용
          return await this.handleBasicMessage(req, res);
        }
      }

      // 1. 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      // 2. 일정 관련 처리
      let scheduleResult = { 
        isScheduleRegistration: false, 
        isScheduleQuery: false, 
        response: null 
      };
      
      try {
        scheduleResult = await this.personalDataDetector.processMessage(
          content.trim(),
          userId,
          chat_room_id
        );
      } catch (scheduleError) {
        console.error('⚠️ Schedule processing error:', scheduleError);
        // 일정 처리 실패 시 일반 대화로 처리
      }

      let botResponse;
      let source;

      // 3. 응답 생성 로직
      if (scheduleResult.isScheduleRegistration && scheduleResult.response) {
        // 일정 등록 시 자연스러운 응답
        botResponse = scheduleResult.response;
        source = 'schedule_registration';
        
      } else if (scheduleResult.isScheduleQuery) {
        // 일정 조회 시
        try {
          const month = this.personalDataDetector.extractMonthFromMessage(content);
          
          if (month) {
            botResponse = await this.personalDataDetector.getMonthlySchedules(userId, month);
            source = 'schedule_query';
          } else {
            // 월이 명시되지 않은 경우
            botResponse = "어떤 월의 일정을 확인하고 싶으신가요? 예: '6월 일정 알려줘'";
            source = 'schedule_query_help';
          }
        } catch (queryError) {
          console.error('⚠️ Schedule query error:', queryError);
          botResponse = await this.askChatGPTWithContext(content, {});
          source = 'chatgpt_fallback';
        }
        
      } else {
        // 일반 대화는 ChatGPT로 처리
        botResponse = await this.askChatGPTWithContext(content, {});
        source = 'chatgpt';
      }

      const responseTime = Date.now() - startTime;
      
      console.log('🤖 Bot response generated:', { 
        source, 
        responseTime,
        isScheduleRegistration: scheduleResult.isScheduleRegistration,
        isScheduleQuery: scheduleResult.isScheduleQuery
      });

      // 4. 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse
      });

      // 5. 채팅방 업데이트
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse);

      // 6. 응답 반환
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseSource: source,
        messageId: botMessageId,
        scheduleInfo: {
          isRegistration: scheduleResult.isScheduleRegistration,
          isQuery: scheduleResult.isScheduleQuery,
          schedulesCount: scheduleResult.schedules ? scheduleResult.schedules.length : 0
        }
      });

    } catch (error) {
      console.error('❌ Error in enhanced sendMessage:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // 기본 메시지 처리 (PersonalDataDetector 없이)
  async handleBasicMessage(req, res) {
    try {
      const { chat_room_id, content } = req.body;
      
      // 1. 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      // 2. ChatGPT로 응답 생성
      const botResponse = await this.askChatGPTWithContext(content, {});

      // 3. 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse
      });

      // 4. 채팅방 업데이트
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse);

      // 5. 응답 반환
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseSource: 'chatgpt_basic',
        messageId: botMessageId,
        scheduleInfo: {
          isRegistration: false,
          isQuery: false,
          schedulesCount: 0
        }
      });

    } catch (error) {
      console.error('❌ Error in basic message handling:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // ChatGPT API 호출
  async askChatGPTWithContext(userMessage, context = {}) {
    try {
      let systemPrompt = `당신은 서울과학기술대학교의 친근하고 도움이 되는 AI 비서입니다.
사용자의 일정을 기억하고 관리하는 기능이 있습니다.
자연스럽고 일상적인 대화를 나누며, 사용자와 친근한 관계를 유지합니다.

답변 스타일:
- 친근하고 자연스러운 한국어 사용
- 이모지를 적절히 활용
- 간결하면서도 도움이 되는 답변 제공
- 일상 대화를 자연스럽게 이어나가기

일정 관련 기능:
- 사용자가 일정을 말하면 기억합니다
- 특정 월의 일정을 조회할 수 있습니다`;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userMessage
            }
          ],
          max_tokens: 500,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices[0].message.content;
      
    } catch (error) {
      console.error('ChatGPT API Error:', error.response?.data || error.message);
      return "죄송합니다. 일시적인 오류가 발생했습니다. 다시 시도해 주세요. 😅";
    }
  }

  // 월별 일정 조회 API
  async getMonthlySchedules(req, res) {
    try {
      const { month } = req.params;
      const userId = req.userId;
      
      const monthNum = parseInt(month);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({
          success: false,
          error: 'Invalid month parameter (1-12)'
        });
      }

      // PersonalDataDetector 확인
      if (!this.personalDataDetector) {
        try {
          this.personalDataDetector = new ImprovedPersonalDataDetector();
        } catch (initError) {
          console.error('❌ Failed to initialize PersonalDataDetector:', initError);
          return res.status(500).json({
            success: false,
            error: 'Schedule service not available'
          });
        }
      }
      
      const scheduleResponse = await this.personalDataDetector.getMonthlySchedules(userId, monthNum);
      
      res.json({
        success: true,
        month: monthNum,
        response: scheduleResponse
      });
      
    } catch (error) {
      console.error('Error getting monthly schedules:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

// 싱글톤 인스턴스 생성 시 오류 처리
let controllerInstance;
try {
  controllerInstance = new ImprovedMessageController();
  console.log('✅ ImprovedMessageController instance created successfully');
} catch (error) {
  console.error('❌ Failed to create ImprovedMessageController instance:', error);
  // 기본 컨트롤러로 폴백
  controllerInstance = {
    sendMessage: async (req, res) => {
      res.status(500).json({ error: 'Message controller initialization failed' });
    },
    getMonthlySchedules: async (req, res) => {
      res.status(500).json({ error: 'Schedule service not available' });
    }
  };
}

module.exports = controllerInstance;