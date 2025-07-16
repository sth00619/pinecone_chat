// server/src/services/ImprovedPersonalDataDetector.js
const pool = require('../config/database');
const ImprovedScheduleStorage = require('./improvedScheduleStorage');
const OpenAI = require('openai');

class ImprovedPersonalDataDetector {
  constructor() {
    this.scheduleStorage = new ImprovedScheduleStorage();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  // 향상된 일정 추출 및 저장
  async extractAndSaveSchedules(text, userId, chatRoomId) {
    try {
      // 먼저 간단한 패턴으로 조회 질문인지 확인
      const isQueryPattern = this.isDefinitelyQuery(text);
      if (isQueryPattern) {
        return {
          hasPersonalInfo: false,
          isScheduleRegistration: false,
          isScheduleQuery: true,
          schedules: [],
          response: null
        };
      }

      const prompt = `
다음 메시지를 정확히 분류해주세요:
"${text}"

규칙:
1. 조회/질문 (isQuery: true): "알려줘", "뭐 있어", "확인", "보여줘", "대해서" 등이 포함된 경우
2. 등록 (isSchedule: true): 구체적인 날짜와 활동이 명시된 경우

JSON 형식:
{
  "isSchedule": true/false,
  "isQuery": true/false,
  "confidence": 0.0-1.0,
  "schedules": [
    {
      "title": "활동명",
      "date": "날짜",
      "time": "시간 (옵션)",
      "location": "장소 (옵션)",
      "confidence": 0.0-1.0
    }
  ]
}

예시:
"6월 2일에 생일 파티에 가기로 했어" → isQuery: false, isSchedule: true, schedules: [{"title": "생일 파티", "date": "6월 2일"}]
"나의 6월 일정에 대해서 알려줘" → isQuery: true, isSchedule: false
`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content);
      
      console.log('🤖 AI Classification Result:', {
        text: text.substring(0, 50),
        isSchedule: result.isSchedule,
        isQuery: result.isQuery,
        confidence: result.confidence,
        schedules: result.schedules
      });
      
      // 일정 등록인 경우
      if (result.isSchedule && !result.isQuery && result.confidence > 0.8) {
        console.log(`📝 Saving ${result.schedules?.length || 0} schedules...`);
        
        const validSchedules = (result.schedules || []).filter(s => s.confidence > 0.7);
        if (validSchedules.length > 0) {
          const savedSchedules = await this.scheduleStorage.saveMultipleSchedules(
            userId, 
            chatRoomId, 
            validSchedules,
            text
          );
          
          return {
            hasPersonalInfo: true,
            isScheduleRegistration: true,
            isScheduleQuery: false,
            schedules: savedSchedules,
            response: this.generateRegistrationResponse(validSchedules)
          };
        }
      }
      
      // 일정 조회인 경우
      if (result.isQuery && !result.isSchedule) {
        return {
          hasPersonalInfo: false,
          isScheduleRegistration: false,
          isScheduleQuery: true,
          schedules: [],
          response: null
        };
      }
      
      // 모호한 경우 조회로 처리
      console.log('⚠️ Ambiguous classification, treating as general message');
      return {
        hasPersonalInfo: false,
        isScheduleRegistration: false,
        isScheduleQuery: false,
        schedules: [],
        response: null
      };
      
    } catch (error) {
      console.error('Schedule extraction error:', error);
      return {
        hasPersonalInfo: false,
        isScheduleRegistration: false,
        isScheduleQuery: false,
        schedules: [],
        response: null
      };
    }
  }

  // 명확한 조회 패턴 확인
  isDefinitelyQuery(text) {
    const definiteQueryPatterns = [
      /일정.*알려/, /일정.*뭐/, /일정.*있/, /일정.*보여/, /일정.*확인/,
      /.*일정.*대해서/, /.*일정.*물어/, /.*일정.*궁금/,
      /스케줄.*알려/, /스케줄.*뭐/, /스케줄.*있/,
      /(\d{1,2}월).*일정.*알려/, /(\d{1,2}월).*일정.*뭐/,
      /나의.*일정/, /내.*일정.*뭐/, /일정에.*대해/
    ];
    
    return definiteQueryPatterns.some(pattern => pattern.test(text));
  }

  // 자연스러운 등록 응답 생성
  generateRegistrationResponse(savedSchedules) {
    if (savedSchedules.length === 0) {
      return "일정을 저장하는데 문제가 있었습니다.";
    }

    if (savedSchedules.length === 1) {
      const schedule = savedSchedules[0];
      return `알겠습니다! ${schedule.title}${schedule.date ? ` (${schedule.date})` : ''}을 기억해두겠습니다. 😊`;
    }

    // 여러 일정인 경우
    const scheduleList = savedSchedules.map(s => 
      `${s.title}${s.date ? ` (${s.date})` : ''}`
    ).join(', ');
    
    return `네, 총 ${savedSchedules.length}개의 일정을 저장했습니다! (${scheduleList}) 📝 필요할 때 언제든 확인해보세요! 😊`;
  }

  // 월별 일정 조회
  async getMonthlySchedules(userId, month, year = null) {
    return await this.scheduleStorage.getMonthlySchedules(userId, month, year);
  }

  // 메인 처리 함수
  async processMessage(message, userId, chatRoomId) {
    try {
      console.log('🔍 Processing message for schedules:', message);
      
      const result = await this.extractAndSaveSchedules(message, userId, chatRoomId);
      
      if (result.isScheduleRegistration) {
        console.log(`✅ Registered ${result.schedules.length} schedule(s)`);
      } else if (result.isScheduleQuery) {
        console.log('📋 Schedule query detected');
      }
      
      return result;
      
    } catch (error) {
      console.error('Error processing message:', error);
      return {
        hasPersonalInfo: false,
        isScheduleRegistration: false,
        isScheduleQuery: false,
        schedules: [],
        response: null
      };
    }
  }

  // 사용자 컨텍스트 구축 (기존 시스템과 호환)
  async buildUserContext(userId, currentMessage) {
    try {
      const context = {
        schedules: [],
        preferences: [],
        goals: [],
        reminders: [],
        birthdays: [],
        locations: [],
        isScheduleQuery: this.isScheduleQuery(currentMessage),
        relevantSchedules: [],
        hasPersonalData: false
      };

      // 일정 데이터 로드
      try {
        const query = `
          SELECT id, data_key, encrypted_value, context, iv, auth_tag, created_at,
                 schedule_title, schedule_date, schedule_time, schedule_location
          FROM user_personal_data 
          WHERE user_id = ? AND data_type = 'schedule' AND is_active = 1
          ORDER BY created_at DESC
          LIMIT 20
        `;
        
        const [rows] = await pool.query(query, [userId]);
        
        if (rows.length > 0) {
          context.schedules = rows.map(row => {
            let title, date, time, location;
            
            if (row.schedule_title) {
              title = row.schedule_title;
              date = row.schedule_date;
              time = row.schedule_time;
              location = row.schedule_location;
            } else {
              try {
                const contextData = JSON.parse(row.context || '{}');
                title = contextData.schedule_title || contextData.title || row.data_key || '일정';
                date = contextData.schedule_date || contextData.date;
                time = contextData.schedule_time || contextData.time;
                location = contextData.schedule_location || contextData.location;
              } catch (error) {
                title = row.data_key || '일정';
                date = null;
                time = null;
                location = null;
              }
            }
            
            return {
              id: row.id,
              title: title,
              date: date,
              time: time,
              location: location,
              datetime: date && time ? `${date} ${time}` : date || '',
              content: title,
              createdAt: row.created_at
            };
          });
          
          context.hasPersonalData = context.schedules.length > 0;
        }
      } catch (error) {
        console.warn('Error loading schedule context:', error);
      }

      // 관련 일정 찾기
      if (context.isScheduleQuery && context.schedules.length > 0) {
        context.relevantSchedules = this.findRelevantSchedules(currentMessage, context.schedules);
      }

      console.log(`📊 Context built: schedules=${context.schedules.length}, relevant=${context.relevantSchedules.length}`);
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

  // 관련 일정 찾기
  findRelevantSchedules(userMessage, schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return [];
    }

    const queryWords = userMessage.toLowerCase().split(/\s+/);
    const relevant = schedules.filter(schedule => {
      const scheduleText = `${schedule.title} ${schedule.date || ''} ${schedule.location || ''}`.toLowerCase();
      return queryWords.some(word => scheduleText.includes(word));
    });

    return relevant.slice(0, 5);
  }

  // 일정 관련 질문인지 확인
  isScheduleQuery(message) {
    const queryPatterns = [
      /일정.*뭐/, /일정.*있/, /무슨.*일정/, /어떤.*일정/,
      /스케줄.*뭐/, /스케줄.*있/, /무슨.*스케줄/,
      /(오늘|내일|이번주|다음주).*일정/,
      /(\d{1,2}월).*일정/, /일정.*(\d{1,2}월)/,
      /내.*일정/, /나의.*일정/, /일정에.*대해/
    ];
    
    return queryPatterns.some(pattern => pattern.test(message));
  }

  // 월 추출
  extractMonthFromMessage(message) {
    const monthPattern = /(\d{1,2})월/;
    const match = message.match(monthPattern);
    if (match) {
      const month = parseInt(match[1]);
      if (month >= 1 && month <= 12) {
        return month;
      }
    }
    return null;
  }
}

module.exports = ImprovedPersonalDataDetector;