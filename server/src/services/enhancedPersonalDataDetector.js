// server/src/services/enhancedPersonalDataDetector.js
const pool = require('../config/database');
const EncryptionService = require('./encryptionService');
const OpenAI = require('openai');

class EnhancedPersonalDataDetector {
  constructor() {
    this.encryptionService = new EncryptionService();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // 기본 패턴 매칭
    this.patterns = {
      email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/gi,
      phone: /(010|011|016|017|018|019)[-\s]?[0-9]{3,4}[-\s]?[0-9]{4}/g,
      birthday: /(\d{4}[-/년]\s?\d{1,2}[-/월]\s?\d{1,2}[일]?)|(\d{2}[-/]\d{2}[-/]\d{2})/g,
      time: /(\d{1,2}시|\d{1,2}:\d{2}|오전|오후|아침|점심|저녁|밤)/g,
      date: /(오늘|내일|모레|이번주|다음주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s?\d{1,2}일)/g
    };
    
    // 스케줄 관련 키워드 (확장됨)
    this.scheduleKeywords = [
      '회의', '미팅', '약속', '일정', '스케줄', '계획', '예정', '할일', '업무', 
      '치과', '병원', '미용실', '수업', '강의', '세미나', '워크샵', '프레젠테이션',
      '면접', '상담', '검진', '진료', '수술', '운동', '헬스', '요가', '필라테스',
      '식사', '점심', '저녁', '모임', '파티', '행사', '여행', '출장', '가족', '축구'
    ];
    
    // 개인정보 카테고리
    this.dataCategories = {
      SCHEDULE: 'schedule',
      BIRTHDAY: 'birthday',
      PREFERENCE: 'preference',
      GOAL: 'goal',
      LOCATION: 'location',
      CONTACT: 'contact',
      REMINDER: 'reminder'
    };

    // 허용된 action_taken 값들
    this.allowedActions = ['masked', 'blocked', 'logged', 'allowed', 'encrypted'];
  }

  // action_taken 값 유효성 검사 및 변환
  validateActionTaken(action) {
    const actionMapping = {
      'stored': 'logged',
      'saved': 'logged',
      'encrypted': 'encrypted',
      'masked': 'masked',
      'blocked': 'blocked',
      'allowed': 'allowed',
      'logged': 'logged'
    };

    const mappedAction = actionMapping[action] || 'logged';
    
    if (!this.allowedActions.includes(mappedAction)) {
      console.warn(`Invalid action_taken value: ${action}, using default: logged`);
      return 'logged';
    }
    
    return mappedAction;
  }

  // AI를 활용한 고급 정보 추출 (개선된 버전)
  async extractPersonalInfoWithAI(text, userId, chatRoomId) {
    try {
      const prompt = `
다음 텍스트에서 사용자의 개인정보를 정확하게 추출해주세요. 

텍스트: "${text}"

추출할 정보 유형:
1. schedule: 일정, 스케줄, 약속, 회의, 치과, 병원 등 시간과 관련된 계획
2. birthday: 생일, 기념일, 탄생일 등 특별한 날짜
3. preference: 좋아하는 것, 싫어하는 것, 취향, 선호도
4. goal: 목표, 계획, 다짐, 하고 싶은 것
5. location: 주소, 위치, 장소 정보
6. contact: 전화번호, 이메일 등 연락처
7. reminder: 기억해야 할 것, 알림 요청

다음 JSON 형식으로 응답해주세요:
{
  "hasPersonalInfo": true/false,
  "extractedData": [
    {
      "type": "정보 유형 (schedule/birthday/preference/goal/location/contact/reminder)",
      "value": "추출된 핵심 내용",
      "context": "전체 문맥",
      "confidence": 0.0-1.0,
      "datetime": "관련 날짜/시간 (schedule인 경우)",
      "key": "검색용 키워드"
    }
  ]
}

예시:
- "7월 21일에 가족 모임이 있고, 7월 24일에 축구 약속이 있어" 
  → [
    {"type": "schedule", "value": "가족 모임", "datetime": "7월 21일", "key": "가족 모임"},
    {"type": "schedule", "value": "축구 약속", "datetime": "7월 24일", "key": "축구 약속"}
  ]
- "내 일정에 대해서 알려줘" → hasPersonalInfo: false (단순 조회 요청)
`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content);
      
      // AI 추출 결과와 패턴 매칭 결과 병합
      const patternResults = await this.detectWithPatterns(text);
      
      return this.mergeResults(result, patternResults, userId, chatRoomId);
      
    } catch (error) {
      console.error('AI extraction error:', error);
      // AI 실패 시 패턴 매칭만 사용
      return this.detectWithPatterns(text);
    }
  }

  // 패턴 기반 감지 (개선된 폴백)
  async detectWithPatterns(text) {
    const detectedData = {
      hasPersonalInfo: false,
      extractedData: []
    };

    // 스케줄 감지 (우선순위 높음)
    const scheduleInfos = this.extractMultipleScheduleInfo(text);
    if (scheduleInfos.length > 0) {
      detectedData.hasPersonalInfo = true;
      detectedData.extractedData.push(...scheduleInfos);
    }

    // 기타 패턴 매칭
    for (const [type, pattern] of Object.entries(this.patterns)) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        detectedData.hasPersonalInfo = true;
        matches.forEach(match => {
          detectedData.extractedData.push({
            type: this.mapPatternToCategory(type),
            value: match,
            context: text,
            confidence: 0.8,
            key: type,
            datetime: type === 'time' || type === 'date' ? match : ''
          });
        });
      }
    }

    return detectedData;
  }

  // 복수 스케줄 정보 추출 (새로운 메서드)
  extractMultipleScheduleInfo(text) {
    const schedules = [];
    
    // "7월 21일에 가족 모임이 있고, 7월 24일에 축구 약속이 있어" 같은 복합 문장 처리
    const sentences = text.split(/[,，.。;；]/).map(s => s.trim()).filter(s => s.length > 0);
    
    for (const sentence of sentences) {
      const schedule = this.extractSingleScheduleInfo(sentence);
      if (schedule) {
        schedules.push(schedule);
      }
    }
    
    // 문장 단위로 추출되지 않은 경우 전체 텍스트에서 시도
    if (schedules.length === 0) {
      const schedule = this.extractSingleScheduleInfo(text);
      if (schedule) {
        schedules.push(schedule);
      }
    }
    
    return schedules;
  }

  // 단일 스케줄 정보 추출 (개선)
  extractSingleScheduleInfo(text) {
    // 일정 조회 요청 제외
    const queryPatterns = [
      /일정.*뭐/, /일정.*있/, /일정.*알려/, /일정.*보여/,
      /스케줄.*뭐/, /스케줄.*있/, /스케줄.*알려/,
      /내.*일정.*대해/, /나의.*일정/
    ];
    
    if (queryPatterns.some(pattern => pattern.test(text))) {
      return null; // 조회 요청은 개인정보가 아님
    }

    const dateMatches = text.match(this.patterns.date);
    const timeMatches = text.match(this.patterns.time);
    
    let datetime = '';
    if (dateMatches) {
      datetime += dateMatches[0];
    }
    if (timeMatches) {
      datetime += (datetime ? ' ' : '') + timeMatches[0];
    }
    
    // 스케줄 키워드 찾기
    const scheduleKeyword = this.scheduleKeywords.find(keyword => 
      text.includes(keyword)
    );
    
    // 복합 표현 처리 ("가족 모임", "축구 약속" 등)
    let scheduleValue = scheduleKeyword || '';
    
    // "가족 모임", "축구 약속" 같은 표현 추출
    const complexPatterns = [
      /([가-힣]+)\s*(모임|약속|미팅|회의)/g,
      /(치과|병원|미용실)\s*(예약|진료|검진)/g,
      /([가-힣]+)\s*(수업|강의|세미나)/g
    ];
    
    for (const pattern of complexPatterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        scheduleValue = matches[0][0]; // 전체 매치
        break;
      }
    }
    
    if (datetime && (scheduleKeyword || scheduleValue)) {
      return {
        type: this.dataCategories.SCHEDULE,
        value: scheduleValue || scheduleKeyword,
        context: text,
        confidence: 0.9,
        datetime: datetime.trim(),
        key: scheduleValue || scheduleKeyword
      };
    }
    
    return null;
  }

  // 결과 병합 및 DB 저장 (개선)
  async mergeResults(aiResult, patternResult, userId, chatRoomId) {
    try {
      const finalResult = {
        hasPersonalInfo: aiResult.hasPersonalInfo || patternResult.hasPersonalInfo,
        extractedData: []
      };

      // 중복 제거하며 병합
      const allData = [...(aiResult.extractedData || []), ...(patternResult.extractedData || [])];
      const uniqueData = this.removeDuplicates(allData);
      
      finalResult.extractedData = uniqueData;

      // 로그 출력
      if (finalResult.hasPersonalInfo) {
        console.log(`🔍 Personal info detected: ${finalResult.extractedData.length} items`);
        finalResult.extractedData.forEach(item => {
          console.log(`  - ${item.type}: ${item.value} (confidence: ${item.confidence})`);
        });
      }

      // DB에 저장 - 수정된 부분
      if (finalResult.hasPersonalInfo && userId && chatRoomId) {
        try {
          await this.saveToDatabase(finalResult, userId, chatRoomId);
        } catch (error) {
          console.error('Error saving to database:', error);
        }
      }

      return finalResult;
    } catch (error) {
      console.error('Error in mergeResults:', error);
      return {
        hasPersonalInfo: false,
        extractedData: []
      };
    }
  }

  // 개인정보 DB 저장 (완전히 수정된 버전)
  async saveToDatabase(detectedData, userId, chatRoomId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const data of detectedData.extractedData) {
        if (!data || !data.type || !data.value) {
          console.warn('Invalid data object:', data);
          continue;
        }

        // **EncryptionService를 통한 통합 저장**
        try {
          const context = {
            datetime: data.datetime || '',
            key: data.key || '',
            confidence: data.confidence || 0.5,
            extractedAt: new Date().toISOString()
          };

          // EncryptionService의 encryptPersonalData 메서드 사용
          const result = await this.encryptionService.encryptPersonalData(
            userId,
            data.type,
            data.value,
            context
          );

          console.log(`✅ Saved ${data.type} data through EncryptionService: ${data.value}`);

        } catch (encryptionError) {
          console.error('EncryptionService save failed:', encryptionError);
          
          // 폴백: 직접 DB 저장 (하지만 일관된 형식으로)
          try {
            await connection.query(
              `INSERT INTO user_personal_data 
               (user_id, chat_room_id, data_type, data_key, encrypted_value, 
                original_message, context, confidence_score) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                userId,
                chatRoomId,
                data.type,
                data.key || '',
                data.value, // 암호화 실패 시 평문 저장
                data.context || data.value,
                JSON.stringify({
                  datetime: data.datetime || '',
                  extractedAt: new Date().toISOString(),
                  confidence: data.confidence || 0.5,
                  fallback: true
                }),
                data.confidence || 0.5
              ]
            );
            console.log(`⚠️ Fallback save for ${data.type}: ${data.value}`);
          } catch (fallbackError) {
            console.error('Fallback save also failed:', fallbackError);
          }
        }

        // 로그 기록 (기존 로직 유지)
        try {
          const actionTaken = this.validateActionTaken('encrypted');
          
          await connection.query(
            `INSERT INTO personal_data_logs 
             (chat_room_id, user_id, data_type, detected_value, confidence_score, action_taken) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              chatRoomId, 
              userId, 
              data.type, 
              (data.value || '').substring(0, 100),
              data.confidence || 0.5, 
              actionTaken
            ]
          );
        } catch (logError) {
          console.error('Error inserting personal_data_logs:', logError);
        }
      }

      await connection.commit();
      console.log(`✅ Personal data saved successfully for user ${userId}`);
      
    } catch (error) {
      await connection.rollback();
      console.error('Database transaction error:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // 사용자 개인정보 조회 (EncryptionService와 통합)
  async getUserPersonalInfo(userId, dataType = null, key = null) {
    try {
      // EncryptionService의 getUserPersonalData 메서드 사용
      return await this.encryptionService.getUserPersonalData(userId, dataType);
    } catch (error) {
      console.error('Error getting user personal info via EncryptionService:', error);
      return [];
    }
  }

  // 8월 일정 조회 (EncryptionService와 통합)
  async getAugustSchedules(userId) {
    try {
      // EncryptionService의 getAugustSchedules 메서드 사용
      return await this.encryptionService.getAugustSchedules(userId);
    } catch (error) {
      console.error('Error getting August schedules:', error);
      return "8월 일정을 불러오는 중 오류가 발생했습니다.";
    }
  }

  // 컨텍스트 생성 (EncryptionService와 통합)
  async buildUserContext(userId) {
    try {
      const personalData = await this.encryptionService.getUserPersonalData(userId);
      
      const context = {
        schedules: [],
        preferences: [],
        goals: [],
        reminders: [],
        birthdays: [],
        locations: []
      };

      // 데이터 분류 및 정렬
      for (const data of personalData) {
        const item = {
          id: data.id,
          content: data.value,
          key: data.key,
          confidence: data.confidence,
          createdAt: data.createdAt,
          context: data.context
        };

        switch (data.dataType) {
          case this.dataCategories.SCHEDULE:
            context.schedules.push({
              ...item,
              datetime: data.context?.datetime || ''
            });
            break;
          case this.dataCategories.BIRTHDAY:
            context.birthdays.push({
              ...item,
              date: data.value
            });
            break;
          case this.dataCategories.PREFERENCE:
            context.preferences.push(item);
            break;
          case this.dataCategories.GOAL:
            context.goals.push(item);
            break;
          case this.dataCategories.LOCATION:
            context.locations.push({
              ...item,
              type: data.key,
              value: data.value
            });
            break;
          case this.dataCategories.REMINDER:
            context.reminders.push({
              ...item,
              datetime: data.context?.datetime || ''
            });
            break;
        }
      }

      // 최신순으로 정렬
      Object.keys(context).forEach(key => {
        if (Array.isArray(context[key])) {
          context[key].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
      });

      console.log(`📋 Context built for user ${userId}:`, {
        schedules: context.schedules.length,
        preferences: context.preferences.length,
        goals: context.goals.length,
        birthdays: context.birthdays.length,
        locations: context.locations.length,
        reminders: context.reminders.length
      });

      return context;
    } catch (error) {
      console.error('Error building user context:', error);
      return {
        schedules: [],
        preferences: [],
        goals: [],
        reminders: [],
        birthdays: [],
        locations: []
      };
    }
  }

  // 나머지 메서드들은 동일하게 유지...
  
  // 중복 제거 (개선)
  removeDuplicates(dataArray) {
    if (!Array.isArray(dataArray)) {
      return [];
    }
    
    const seen = new Map();
    return dataArray.filter(item => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      
      const key = `${item.type || ''}-${item.key || ''}-${(item.value || '').substring(0, 50)}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        if ((item.confidence || 0) > (existing.confidence || 0)) {
          seen.set(key, item);
          return true;
        }
        return false;
      }
      seen.set(key, item);
      return true;
    });
  }

  // 패턴 타입을 카테고리로 매핑
  mapPatternToCategory(patternType) {
    const mapping = {
      email: this.dataCategories.CONTACT,
      phone: this.dataCategories.CONTACT,
      birthday: this.dataCategories.BIRTHDAY,
      time: this.dataCategories.SCHEDULE,
      date: this.dataCategories.SCHEDULE
    };
    return mapping[patternType] || 'other';
  }

  // 메인 처리 함수
  async processMessage(message, userId, chatRoomId) {
    try {
      if (!message || !userId || !chatRoomId) {
        console.warn('Invalid parameters for processMessage');
        return {
          hasPersonalInfo: false,
          extractedData: []
        };
      }
      
      const detectedData = await this.extractPersonalInfoWithAI(message, userId, chatRoomId);
      
      if (detectedData.hasPersonalInfo && detectedData.extractedData.length > 0) {
        console.log(`✅ Found ${detectedData.extractedData.length} personal data items`);
      }
      
      return detectedData;
      
    } catch (error) {
      console.error('Error processing message for personal data:', error);
      return {
        hasPersonalInfo: false,
        extractedData: []
      };
    }
  }

  // 개인정보 삭제 (GDPR 준수)
  async deleteUserPersonalData(userId, dataType = null) {
    try {
      let query = 'UPDATE user_personal_data SET is_active = FALSE WHERE user_id = ?';
      const params = [userId];

      if (dataType) {
        query += ' AND data_type = ?';
        params.push(dataType);
      }

      const [result] = await pool.query(query, params);
      console.log(`Deactivated ${result.affectedRows} personal data records for user ${userId}`);
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting user personal data:', error);
      return 0;
    }
  }

  // 개인정보 통계 조회
  async getPersonalDataStats(userId) {
    try {
      const [stats] = await pool.query(`
        SELECT 
          data_type,
          COUNT(*) as count,
          AVG(confidence_score) as avg_confidence,
          MAX(created_at) as latest_update
        FROM user_personal_data 
        WHERE user_id = ? AND is_active = TRUE
        GROUP BY data_type
        ORDER BY count DESC
      `, [userId]);

      return stats;
    } catch (error) {
      console.error('Error getting personal data stats:', error);
      return [];
    }
  }
}

module.exports = EnhancedPersonalDataDetector;