// server/src/services/userContextManager.js
const redis = require('redis');
const pool = require('../config/database');

class UserContextManager {
  constructor() {
    // Redis 클라이언트 초기화
    this.redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    });

    this.redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.redisClient.connect().catch(console.error);
    
    // 캐시 TTL (24시간)
    this.cacheTTL = 86400;
  }

  // 사용자 컨텍스트 캐시 키 생성
  getUserContextKey(userId, chatRoomId = null) {
    return chatRoomId 
      ? `user_context:${userId}:${chatRoomId}`
      : `user_context:${userId}`;
  }

  // 사용자 컨텍스트 로드 (캐시 우선)
  async loadUserContext(userId, chatRoomId = null) {
    const cacheKey = this.getUserContextKey(userId, chatRoomId);
    
    try {
      // Redis 캐시 확인
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        console.log('📦 Context loaded from cache');
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Redis get error:', error);
    }

    // DB에서 로드
    const context = await this.buildContextFromDB(userId, chatRoomId);
    
    // 캐시에 저장
    try {
      await this.redisClient.setEx(
        cacheKey, 
        this.cacheTTL, 
        JSON.stringify(context)
      );
    } catch (error) {
      console.error('Redis set error:', error);
    }

    return context;
  }

  // DB에서 컨텍스트 구축
  async buildContextFromDB(userId, chatRoomId = null) {
    const context = {
      userId,
      chatRoomId,
      personalInfo: {
        schedules: [],
        birthdays: [],
        preferences: [],
        goals: [],
        locations: [],
        contacts: [],
        reminders: []
      },
      recentMessages: [],
      sessionInfo: {},
      metadata: {
        lastUpdated: new Date().toISOString()
      }
    };

    // 개인정보 로드
    const personalData = await this.loadPersonalData(userId);
    context.personalInfo = personalData;

    // 최근 메시지 로드
    if (chatRoomId) {
      context.recentMessages = await this.loadRecentMessages(chatRoomId, 10);
    }

    // 세션 정보 로드
    context.sessionInfo = await this.loadSessionInfo(userId);

    return context;
  }

  // 개인정보 로드
  async loadPersonalData(userId) {
    const query = `
      SELECT 
        upd.*,
        JSON_UNQUOTE(JSON_EXTRACT(context, '$.datetime')) as datetime
      FROM user_personal_data upd
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY created_at DESC
    `;

    const [rows] = await pool.query(query, [userId]);

    const personalInfo = {
      schedules: [],
      birthdays: [],
      preferences: [],
      goals: [],
      locations: [],
      contacts: [],
      reminders: []
    };

    // 데이터 분류
    for (const row of rows) {
      const data = {
        id: row.id,
        value: row.original_message || '',
        datetime: row.datetime,
        createdAt: row.created_at,
        key: row.data_key
      };

      switch (row.data_type) {
        case 'schedule':
          personalInfo.schedules.push(data);
          break;
        case 'birthday':
          personalInfo.birthdays.push(data);
          break;
        case 'preference':
          personalInfo.preferences.push(data.value);
          break;
        case 'goal':
          personalInfo.goals.push(data.value);
          break;
        case 'location':
          personalInfo.locations.push(data);
          break;
        case 'contact':
          personalInfo.contacts.push(data);
          break;
        case 'reminder':
          personalInfo.reminders.push(data);
          break;
      }
    }

    return personalInfo;
  }

  // 최근 메시지 로드
  async loadRecentMessages(chatRoomId, limit = 10) {
    const query = `
      SELECT id, role, content, created_at
      FROM messages
      WHERE chat_room_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(query, [chatRoomId, limit]);
    return rows.reverse(); // 시간순으로 정렬
  }

  // 세션 정보 로드
  async loadSessionInfo(userId) {
    const query = `
      SELECT 
        COUNT(DISTINCT cr.id) as total_chats,
        COUNT(m.id) as total_messages,
        MAX(m.created_at) as last_activity
      FROM chat_rooms cr
      LEFT JOIN messages m ON cr.id = m.chat_room_id
      WHERE cr.user_id = ? AND cr.is_active = TRUE
    `;

    const [rows] = await pool.query(query, [userId]);
    
    return {
      totalChats: rows[0].total_chats || 0,
      totalMessages: rows[0].total_messages || 0,
      lastActivity: rows[0].last_activity
    };
  }

  // 컨텍스트 업데이트
  async updateContext(userId, chatRoomId, updates) {
    const cacheKey = this.getUserContextKey(userId, chatRoomId);
    
    try {
      const context = await this.loadUserContext(userId, chatRoomId);
      
      // 업데이트 적용
      Object.assign(context, updates);
      context.metadata.lastUpdated = new Date().toISOString();
      
      // 캐시 업데이트
      await this.redisClient.setEx(
        cacheKey,
        this.cacheTTL,
        JSON.stringify(context)
      );
      
      return context;
    } catch (error) {
      console.error('Context update error:', error);
      throw error;
    }
  }

  // 컨텍스트 무효화
  async invalidateContext(userId, chatRoomId = null) {
    const cacheKey = this.getUserContextKey(userId, chatRoomId);
    
    try {
      await this.redisClient.del(cacheKey);
      console.log('🗑️ Context cache invalidated');
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  // 개인정보 기반 리마인더 생성
  async generateReminders(userId) {
    const context = await this.loadUserContext(userId);
    const reminders = [];
    const now = new Date();

    // 스케줄 리마인더
    for (const schedule of context.personalInfo.schedules) {
      if (schedule.datetime) {
        const scheduleDate = this.parseDateTime(schedule.datetime);
        if (scheduleDate && scheduleDate > now) {
          const timeDiff = scheduleDate - now;
          const hoursDiff = timeDiff / (1000 * 60 * 60);
          
          if (hoursDiff <= 24) {
            reminders.push({
              type: 'schedule',
              content: schedule.value,
              datetime: schedule.datetime,
              urgency: hoursDiff <= 2 ? 'high' : 'medium'
            });
          }
        }
      }
    }

    // 생일 리마인더
    for (const birthday of context.personalInfo.birthdays) {
      const birthdayDate = this.parseBirthday(birthday.value);
      if (birthdayDate) {
        const daysDiff = this.getDaysDifference(now, birthdayDate);
        
        if (daysDiff >= 0 && daysDiff <= 7) {
          reminders.push({
            type: 'birthday',
            content: `${birthday.key}: ${birthday.value}`,
            daysLeft: daysDiff,
            urgency: daysDiff === 0 ? 'high' : 'low'
          });
        }
      }
    }

    return reminders;
  }

  // 날짜/시간 파싱 헬퍼
  parseDateTime(datetimeStr) {
    // "다음주 월요일 오후 2시" 같은 한국어 날짜 파싱
    // 실제 구현은 더 복잡할 수 있음
    const now = new Date();
    
    if (datetimeStr.includes('내일')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    if (datetimeStr.includes('모레')) {
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      return dayAfter;
    }
    
    // 더 복잡한 파싱 로직 필요
    return null;
  }

  parseBirthday(birthdayStr) {
    // "3월 15일" 같은 생일 파싱
    const match = birthdayStr.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (match) {
      const now = new Date();
      const birthday = new Date(now.getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]));
      
      // 이미 지났으면 내년으로
      if (birthday < now) {
        birthday.setFullYear(birthday.getFullYear() + 1);
      }
      
      return birthday;
    }
    return null;
  }

  getDaysDifference(date1, date2) {
    const timeDiff = date2 - date1;
    return Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  }

  // 컨텍스트 요약 생성 (AI 응답용)
  generateContextSummary(context) {
    const summary = [];
    
    if (context.personalInfo.schedules.length > 0) {
      summary.push(`일정: ${context.personalInfo.schedules.length}개`);
    }
    
    if (context.personalInfo.birthdays.length > 0) {
      summary.push(`생일/기념일: ${context.personalInfo.birthdays.length}개`);
    }
    
    if (context.personalInfo.preferences.length > 0) {
      summary.push(`선호도: ${context.personalInfo.preferences.length}개`);
    }
    
    if (context.personalInfo.goals.length > 0) {
      summary.push(`목표: ${context.personalInfo.goals.length}개`);
    }
    
    return summary.join(', ');
  }

  // 리소스 정리
  async cleanup() {
    try {
      await this.redisClient.quit();
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Redis cleanup error:', error);
    }
  }
}

module.exports = UserContextManager;