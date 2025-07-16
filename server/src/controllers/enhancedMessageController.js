// server/src/controllers/enhancedMessageController.js
const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const knowledgeDao = require('../dao/knowledgeDao');
const pineconeDao = require('../dao/pineconeDao');
const learningDao = require('../dao/learningDao');
const EnhancedPersonalDataDetector = require('../services/enhancedPersonalDataDetector');
const UserContextManager = require('../services/userContextManager');
const ScheduleService = require('../services/ScheduleService');
const axios = require('axios');

class EnhancedMessageController {
  constructor() {
    this.scheduleService = new ScheduleService();
    this.personalDataDetector = new EnhancedPersonalDataDetector();
    this.contextManager = new UserContextManager();
    
    // 메서드 바인딩
    this.sendMessage = this.sendMessage.bind(this);
    this.generateBotResponse = this.generateBotResponse.bind(this);
  }

  // 개선된 메시지 전송 처리
  async sendMessage(req, res) {
    try {
      console.log('Enhanced sendMessage called with:', req.body);
      const startTime = Date.now();
      const { chat_room_id, content } = req.body;
      const userId = req.userId; // authMiddleware에서 설정

      // 입력 검증
      if (!chat_room_id || !content) {
        return res.status(400).json({ error: 'chat_room_id and content are required' });
      }

      // 채팅방 확인
      const chatRoom = await chatRoomDao.getChatRoomById(chat_room_id);
      if (!chatRoom) {
        return res.status(404).json({ error: 'Chat room not found' });
      }

      // 1. 개인정보 감지 및 저장
      console.log('🔍 Detecting personal information...');
      const personalDataResult = await this.personalDataDetector.extractPersonalInfoWithAI(
        content,
        userId,
        chat_room_id
      );

      if (personalDataResult.hasPersonalInfo) {
        console.log('✅ Personal information detected:', personalDataResult.extractedData);
      }

      // 2. 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      // 3. 사용자 컨텍스트 로드 (개선된 버전)
      const userContext = await this.buildUserContext(userId, content);
      console.log('📋 User context loaded:', {
        schedulesCount: userContext.schedules.length,
        preferencesCount: userContext.preferences.length,
        birthdaysCount: userContext.birthdays.length,
        isScheduleQuery: userContext.isScheduleQuery
      });

      // 4. AI 응답 생성 (컨텍스트 포함)
      const { response: botResponse, matchedId, source } = await this.generateBotResponse(
        content,
        userContext,
        userId
      );

      const responseTime = Date.now() - startTime;
      
      console.log('Bot response generated:', { 
        source, 
        matchedId, 
        responseTime,
        hasContext: Object.values(userContext).some(arr => Array.isArray(arr) && arr.length > 0)
      });

      // 5. 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse
      });

      // 6. 채팅방 업데이트
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse);

      // 7. 분석 로그 저장
      const analyticsId = await knowledgeDao.logChatAnalytics(
        content.trim(),
        botResponse,
        matchedId,
        responseTime
      );

      // 8. 학습 큐에 추가
      this.addToLearningQueue({
        chat_analytics_id: analyticsId,
        user_message: content.trim(),
        bot_response: botResponse,
        response_source: source,
        confidence_score: source === 'personal' ? 0.95 : source === 'pinecone' ? 0.9 : 0.7,
        matched_knowledge_id: matchedId
      });

      // 9. 응답 반환
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseSource: source,
        messageId: botMessageId,
        hasPersonalContext: Object.values(userContext).some(arr => Array.isArray(arr) && arr.length > 0),
        personalDataDetected: personalDataResult.hasPersonalInfo
      });

    } catch (error) {
      console.error('Error in enhanced sendMessage:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // 사용자 컨텍스트 구축 (개선된 버전)
  async buildUserContext(userId, currentMessage) {
    try {
      // 기본 컨텍스트 로드
      const baseContext = await this.personalDataDetector.buildUserContext(userId);
      
      // 일정 관련 질문인지 확인
      const isScheduleQuery = this.isScheduleRelatedQuery(currentMessage);
      
      // 특정 일정 검색 (일정 관련 질문인 경우)
      let relevantSchedules = [];
      if (isScheduleQuery && baseContext.schedules.length > 0) {
        relevantSchedules = this.findRelevantSchedules(currentMessage, baseContext.schedules);
      }

      const context = {
        ...baseContext,
        isScheduleQuery,
        relevantSchedules,
        hasPersonalData: Object.values(baseContext).some(arr => Array.isArray(arr) && arr.length > 0)
      };

      console.log(`📊 Enhanced context built: schedules=${context.schedules.length}, relevant=${relevantSchedules.length}`);
      return context;

    } catch (error) {
      console.error('Error building user context:', error);
      return {
        schedules: [],
        preferences: [],
        goals: [],
        reminders: [],
        birthdays: [],
        locations: [],
        isScheduleQuery: false,
        relevantSchedules: [],
        hasPersonalData: false
      };
    }
  }

  // 일정 관련 질문인지 확인
  isScheduleRelatedQuery(message) {
    const scheduleKeywords = [
      '일정', '스케줄', '약속', '계획', '예정',
      '언제', '몇시', '날짜', '시간',
      '치과', '병원', '회의', '미팅',
      '오늘', '내일', '이번주', '다음주',
      '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일',
      '뭐가', '뭐', '있어', '있나', '무엇',
      '1월', '2월', '3월', '4월', '5월', '6월',
      '7월', '8월', '9월', '10월', '11월', '12월'
    ];

    return scheduleKeywords.some(keyword => message.includes(keyword));
  }

  // 관련 일정 찾기
  findRelevantSchedules(userMessage, schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return [];
    }

    // 날짜/시간 키워드 매칭
    const dateKeywords = ['오늘', '내일', '모레', '이번주', '다음주', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
    const activityKeywords = ['치과', '병원', '회의', '미팅', '약속', '수업', '강의'];

    let relevantSchedules = [];

    // 특정 날짜/시간으로 검색
    for (const keyword of dateKeywords) {
      if (userMessage.includes(keyword)) {
        const matchingSchedules = schedules.filter(schedule => 
          schedule.datetime.includes(keyword) || schedule.content.includes(keyword)
        );
        relevantSchedules.push(...matchingSchedules);
      }
    }

    // 특정 활동으로 검색
    for (const activity of activityKeywords) {
      if (userMessage.includes(activity)) {
        const matchingSchedules = schedules.filter(schedule => 
          schedule.content.includes(activity)
        );
        relevantSchedules.push(...matchingSchedules);
      }
    }

    // 중복 제거
    const uniqueSchedules = relevantSchedules.filter((schedule, index, self) => 
      index === self.findIndex(s => s.content === schedule.content)
    );

    // 관련 일정이 없으면 모든 일정 반환 (최대 5개)
    if (uniqueSchedules.length === 0) {
      return schedules.slice(0, 5);
    }

    return uniqueSchedules.slice(0, 5);
  }

  // 개선된 봇 응답 생성 (일정 조회 우선 처리)
  async generateBotResponse(userMessage, userContext, userId) {
    try {
      console.log('🤖 Generating personalized response...');

      // 1. 일정 관련 질문 우선 처리 (ScheduleService 사용)
      const scheduleKeywords = ['일정', '스케줄', '계획'];
      const isScheduleQuery = scheduleKeywords.some(keyword => userMessage.includes(keyword));
      
      if (isScheduleQuery) {
        // 일정 추가인지 조회인지 구분
        const addKeywords = ['추가', '등록', '만들', '생성', '넣어'];
        const queryKeywords = ['뭐', '있', '알려', '보여', '확인', '조회'];
        
        const isAddRequest = addKeywords.some(keyword => userMessage.includes(keyword));
        const isQueryRequest = queryKeywords.some(keyword => userMessage.includes(keyword));
        
        if (isQueryRequest && !isAddRequest) {
          // 일정 조회 요청 - ScheduleService 사용
          console.log('📅 Processing schedule query via ScheduleService...');
          const scheduleResponse = await this.scheduleService.handleScheduleQuery(userMessage, userId);
          return {
            response: scheduleResponse,
            matchedId: null,
            source: 'schedule_query'
          };
        }
      }

      // 2. 개인정보 기반 응답 확인
      const personalResponse = await this.checkPersonalInfoResponse(userMessage, userContext);
      if (personalResponse) {
        console.log('✅ Found personal information match');
        return {
          response: personalResponse,
          matchedId: null,
          source: 'personal'
        };
      }

      // 3. Pinecone 검색 (개인 컨텍스트 포함)
      try {
        const pineconeResult = await this.searchWithContext(userMessage, userContext);
        if (pineconeResult && pineconeResult.score >= 0.8) {
          console.log('✅ High confidence match found in Pinecone');
          return {
            response: pineconeResult.answer,
            matchedId: pineconeResult.id,
            source: 'pinecone'
          };
        }
      } catch (pineconeError) {
        console.error('Pinecone search error:', pineconeError);
      }

      // 4. 로컬 DB 검색
      const dbResult = await this.generateBotResponseFromDB(userMessage);
      if (dbResult.matchedId) {
        console.log('✅ Match found in local DB');
        return {
          response: dbResult.response,
          matchedId: dbResult.matchedId,
          source: 'localdb'
        };
      }

      // 5. ChatGPT with context (개인정보 컨텍스트 포함)
      console.log('📡 Using ChatGPT with user context...');
      const gptResponse = await this.askChatGPTWithContext(userMessage, userContext);
      
      // GPT 응답을 Pinecone에 저장
      await this.saveGPTResponseToPinecone(userMessage, gptResponse);
      
      return {
        response: gptResponse,
        matchedId: null,
        source: 'chatgpt'
      };

    } catch (error) {
      console.error('Error generating bot response:', error);
      return {
        response: '죄송합니다. 일시적인 오류가 발생했습니다. 다시 시도해 주세요.',
        matchedId: null,
        source: 'error'
      };
    }
  }

  // 개인정보 기반 응답 확인 (개선된 버전)
  async checkPersonalInfoResponse(userMessage, userContext) {
    const lowerMessage = userMessage.toLowerCase();
    
    // 스케줄 관련 질문 (우선순위 높음)
    if (this.isAskingAboutSchedule(lowerMessage)) {
      if (userContext.relevantSchedules.length > 0) {
        return this.generateScheduleResponse(userContext.relevantSchedules, true); // 관련 일정만
      } else {
        return this.generateScheduleResponse(userContext.schedules, false); // 전체 일정
      }
    }
    
    // 생일 관련 질문
    if (this.isAskingAboutBirthday(lowerMessage)) {
      return this.generateBirthdayResponse(userContext.birthdays);
    }
    
    // 선호도 관련 질문
    if (this.isAskingAboutPreference(lowerMessage)) {
      return this.generatePreferenceResponse(userContext.preferences);
    }
    
    // 목표 관련 질문
    if (this.isAskingAboutGoal(lowerMessage)) {
      return this.generateGoalResponse(userContext.goals);
    }
    
    return null;
  }

  // 스케줄 관련 질문 확인 (개선)
  isAskingAboutSchedule(message) {
    const schedulePatterns = [
      /일정.*뭐/, /일정.*있/, /무슨.*일정/, /어떤.*일정/,
      /스케줄.*뭐/, /스케줄.*있/, /무슨.*스케줄/,
      /약속.*뭐/, /약속.*있/, /무슨.*약속/,
      /언제.*가/, /언제.*해/, /몇시/, /시간/,
      /(오늘|내일|이번주|다음주).*뭐/, /(오늘|내일|이번주|다음주).*일정/,
      /내.*일정/, /나의.*일정/, /내가.*해야/,
      /(\d{1,2}월).*일정/, /일정.*(\d{1,2}월)/
    ];
    
    return schedulePatterns.some(pattern => pattern.test(message)) ||
           ['일정', '스케줄', '약속', '언제', '몇시', '뭐가', '뭐', '있어', '있나'].some(keyword => message.includes(keyword));
  }

  // 스케줄 응답 생성 (개선된 버전)
  generateScheduleResponse(schedules, isFiltered = false) {
    if (!schedules || schedules.length === 0) {
      return '📅 등록된 일정이 없습니다. 일정을 말씀해주시면 기억해두겠습니다!';
    }

    const prefix = isFiltered ? '🔍 관련 일정을 찾았습니다' : '📅 등록된 일정';
    let response = `${prefix}:\n\n`;
    
    // 최근 순으로 정렬
    const sortedSchedules = schedules
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10); // 최대 10개만 표시

    sortedSchedules.forEach((schedule, index) => {
      response += `${index + 1}. `;
      if (schedule.datetime) {
        response += `**${schedule.datetime}** `;
      }
      response += `${schedule.content}\n`;
    });

    if (schedules.length > 10) {
      response += `\n*(총 ${schedules.length}개 일정 중 최근 10개만 표시)*`;
    }

    response += '\n\n추가 일정이 있으시면 말씀해주세요! 😊';
    
    return response;
  }

  // ChatGPT API 호출 (개선된 컨텍스트 포함)
  async askChatGPTWithContext(userMessage, userContext) {
    try {
      // 개선된 컨텍스트 문자열 생성
      let contextString = '';
      
      if (userContext.schedules.length > 0) {
        contextString += '\n📅 사용자의 일정:\n';
        userContext.schedules.slice(0, 10).forEach((s, i) => {
          contextString += `${i + 1}. ${s.datetime ? `[${s.datetime}] ` : ''}${s.content}\n`;
        });
      }
      
      if (userContext.birthdays.length > 0) {
        contextString += '\n🎂 사용자의 생일/기념일:\n';
        userContext.birthdays.forEach(b => {
          contextString += `- ${b.key}: ${b.date}\n`;
        });
      }
      
      if (userContext.preferences.length > 0) {
        contextString += '\n❤️ 사용자의 선호도:\n';
        userContext.preferences.forEach(p => {
          contextString += `- ${p}\n`;
        });
      }

      if (userContext.goals.length > 0) {
        contextString += '\n🎯 사용자의 목표:\n';
        userContext.goals.forEach(g => {
          contextString += `- ${g}\n`;
        });
      }

      // 일정 관련 질문에 대한 특별 지시
      let specialInstructions = '';
      if (userContext.isScheduleQuery) {
        if (userContext.relevantSchedules.length > 0) {
          specialInstructions = '\n🔍 사용자가 일정에 대해 문의했고, 관련 일정을 찾았습니다. 위의 일정 정보를 바탕으로 정확하고 친근한 답변을 제공해주세요.';
        } else if (userContext.schedules.length > 0) {
          specialInstructions = '\n📋 사용자가 일정에 대해 문의했습니다. 위의 모든 일정 정보를 바탕으로 도움이 되는 답변을 제공해주세요.';
        } else {
          specialInstructions = '\n📅 사용자가 일정에 대해 문의했지만 등록된 일정이 없습니다. 일정을 추가할 수 있음을 안내해주세요.';
        }
      }

      const systemPrompt = `당신은 서울과학기술대학교의 친근하고 도움이 되는 AI 비서입니다. 
사용자의 개인정보를 기억하고 활용하여 맞춤형 답변을 제공합니다.
${contextString}${specialInstructions}

답변 스타일:
- 친근하고 자연스러운 한국어 사용
- 이모지를 적절히 활용
- 구체적이고 실용적인 정보 제공
- 사용자의 개인정보를 적극 활용하여 개인화된 답변 제공`;

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
          max_tokens: 800,
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
      
      // 컨텍스트 기반 폴백 응답
      if (userContext.isScheduleQuery) {
        return this.generateScheduleResponse(userContext.schedules);
      }
      
      throw error;
    }
  }

  // Pinecone 검색 (컨텍스트 포함)
  async searchWithContext(userMessage, userContext) {
    // 컨텍스트를 포함한 검색 쿼리 생성
    let enhancedQuery = userMessage;
    
    // 일정 관련 질문인 경우 관련 컨텍스트 추가
    if (userContext.isScheduleQuery && userContext.schedules.length > 0) {
      const scheduleContext = userContext.schedules
        .slice(0, 3)
        .map(s => s.content)
        .join(' ');
      enhancedQuery += ` 일정 컨텍스트: ${scheduleContext}`;
    }
    
    return await pineconeDao.searchAnswer(enhancedQuery, 5);
  }

  // 사용자 일정 조회 API
  async getUserSchedules(req, res) {
    try {
      const userId = req.userId;
      
      const schedules = await this.personalDataDetector.getUserPersonalInfo(
        userId, 
        'schedule'
      );

      res.json({
        success: true,
        schedules: schedules.map(schedule => ({
          id: schedule.id,
          content: schedule.value,
          datetime: schedule.context?.datetime || '',
          key: schedule.key,
          confidence: schedule.confidence,
          createdAt: schedule.createdAt
        }))
      });

    } catch (error) {
      console.error('Error getting user schedules:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 일정 검색 API
  async searchSchedules(req, res) {
    try {
      const { query } = req.body;
      const userId = req.userId;
      
      const userContext = await this.buildUserContext(userId, query);
      
      res.json({
        success: true,
        queryType: userContext.isScheduleQuery ? 'schedule' : 'general',
        allSchedules: userContext.schedules,
        relevantSchedules: userContext.relevantSchedules,
        hasMatches: userContext.relevantSchedules.length > 0
      });
      
    } catch (error) {
      console.error('Error searching schedules:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 월별 일정 조회 API (새로 추가)
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
      
      const scheduleResponse = await this.scheduleService.getMonthlySchedules(userId, monthNum);
      
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

  // 기존 메서드들...
  generateBirthdayResponse(birthdays) {
    if (!birthdays || birthdays.length === 0) {
      return '🎂 등록된 생일이나 기념일이 없습니다. 알려주시면 기억해두겠습니다!';
    }
    
    let response = '🎂 기억하고 있는 날짜들입니다:\n\n';
    birthdays.forEach(b => {
      response += `- ${b.key}: ${b.date}\n`;
    });
    
    return response;
  }

  generatePreferenceResponse(preferences) {
    if (!preferences || preferences.length === 0) {
      return '❤️ 아직 파악한 선호도가 없습니다. 좋아하시는 것들을 알려주세요!';
    }
    
    let response = '❤️ 제가 알고 있는 당신의 선호도입니다:\n\n';
    preferences.forEach((p, i) => {
      response += `${i + 1}. ${p}\n`;
    });
    
    return response;
  }

  generateGoalResponse(goals) {
    if (!goals || goals.length === 0) {
      return '🎯 등록된 목표가 없습니다. 이루고 싶은 목표를 알려주세요!';
    }
    
    let response = '🎯 당신의 목표:\n\n';
    goals.forEach((g, i) => {
      response += `${i + 1}. ${g}\n`;
    });
    response += '\n목표 달성을 응원합니다! 💪';
    
    return response;
  }

  // 기타 헬퍼 메서드들...
  isAskingAboutBirthday(message) {
    return ['생일', '기념일', '탄생일', '생년월일'].some(k => message.includes(k));
  }

  isAskingAboutPreference(message) {
    return ['좋아', '싫어', '선호', '취향'].some(k => message.includes(k));
  }

  isAskingAboutGoal(message) {
    return ['목표', '계획', '다짐', '하고싶', '되고싶'].some(k => message.includes(k));
  }

  // 기존 메서드들 유지...
  async generateBotResponseFromDB(userMessage) {
    try {
      const exactMatch = await knowledgeDao.getExactAnswer(userMessage);
      if (exactMatch) {
        return { response: exactMatch.answer, matchedId: exactMatch.id };
      }

      const keywordResults = await knowledgeDao.searchByKeywords(userMessage);
      if (keywordResults.length > 0) {
        return { response: keywordResults[0].answer, matchedId: keywordResults[0].id };
      }

      return { response: null, matchedId: null };
    } catch (error) {
      console.error('Error in DB search:', error);
      return { response: null, matchedId: null };
    }
  }

  async saveGPTResponseToPinecone(question, answer) {
    try {
      setImmediate(async () => {
        await pineconeDao.addKnowledge({
          question,
          answer,
          keywords: this.extractKeywords(question),
          category: 'chatgpt-generated',
          priority: 5
        });
      });
    } catch (error) {
      console.error('Error saving to Pinecone:', error);
    }
  }

  extractKeywords(text) {
    const words = text.split(/\s+/).filter(w => w.length > 2);
    return words.slice(0, 5).join(', ');
  }

  async addToLearningQueue(data) {
    try {
      await learningDao.addToLearningQueue(data);
    } catch (error) {
      console.error('Error adding to learning queue:', error);
    }
  }
}

module.exports = new EnhancedMessageController();