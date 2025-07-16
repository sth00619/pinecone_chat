// server/src/services/ImprovedScheduleStorage.js
const pool = require('../config/database');
const crypto = require('crypto');

class ImprovedScheduleStorage {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.masterKey = Buffer.from(process.env.ENCRYPTION_MASTER_KEY || crypto.randomBytes(32));
  }

  // 통합된 일정 저장 (하나의 행에 모든 정보)
  async saveIntegratedSchedule(userId, chatRoomId, scheduleData, originalMessage) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      console.log('💾 Saving integrated schedule:', scheduleData);

      // 날짜 파싱
      const parsedDate = this.parseDateString(scheduleData.date);
      const parsedTime = this.parseTimeString(scheduleData.time);

      // 통합된 일정 객체 생성
      const integratedSchedule = {
        title: scheduleData.title || scheduleData.activity || '일정',
        date: scheduleData.date || null,
        time: scheduleData.time || null,
        location: scheduleData.location || null,
        description: scheduleData.description || '',
        originalMessage: originalMessage
      };

      // JSON으로 저장할 내용
      const scheduleJson = JSON.stringify(integratedSchedule);

      // 암호화 처리
      let encryptedValue = scheduleJson;
      let iv = null;
      let authTag = null;

      try {
        const ivBuffer = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, ivBuffer);
        
        let encrypted = cipher.update(scheduleJson, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTagBuffer = cipher.getAuthTag();
        
        encryptedValue = encrypted;
        iv = ivBuffer.toString('hex');
        authTag = authTagBuffer.toString('hex');
      } catch (encryptionError) {
        console.warn('Encryption failed, storing as plain text:', encryptionError.message);
      }

      // 컨텍스트 생성
      const context = {
        title: integratedSchedule.title,
        date: integratedSchedule.date,
        time: integratedSchedule.time,
        location: integratedSchedule.location,
        extractedAt: new Date().toISOString(),
        confidence: scheduleData.confidence || 0.9
      };

      // 통합된 일정을 하나의 행에 저장 (컬럼 존재 여부 확인)
      try {
        // 새 컬럼이 있는지 확인
        const [columns] = await connection.query(
          "SHOW COLUMNS FROM user_personal_data LIKE 'schedule_title'"
        );
        
        const hasNewColumns = columns.length > 0;
        
        let query, params;
        
        if (hasNewColumns) {
          // 새 컬럼이 있는 경우
          query = `INSERT INTO user_personal_data 
                   (user_id, chat_room_id, data_type, data_key, encrypted_value, 
                    original_message, iv, auth_tag, context, confidence_score,
                    schedule_title, schedule_date, schedule_time, schedule_location) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          params = [
            userId, chatRoomId, 'schedule', integratedSchedule.title,
            encryptedValue, originalMessage, iv, authTag,
            JSON.stringify(context), scheduleData.confidence || 0.9,
            integratedSchedule.title, parsedDate, parsedTime, integratedSchedule.location
          ];
        } else {
          // 기존 컬럼만 사용 (context에 모든 정보 저장)
          const enhancedContext = {
            ...context,
            schedule_title: integratedSchedule.title,
            schedule_date: parsedDate,
            schedule_time: parsedTime,
            schedule_location: integratedSchedule.location
          };
          
          query = `INSERT INTO user_personal_data 
                   (user_id, chat_room_id, data_type, data_key, encrypted_value, 
                    original_message, iv, auth_tag, context, confidence_score) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          params = [
            userId, chatRoomId, 'schedule', integratedSchedule.title,
            encryptedValue, originalMessage, iv, authTag,
            JSON.stringify(enhancedContext), scheduleData.confidence || 0.9
          ];
        }
        
        const [result] = await connection.query(query, params);
        
        console.log(`✅ Integrated schedule saved (${hasNewColumns ? 'new' : 'legacy'} format): ID ${result.insertId}`);
        return {
          id: result.insertId,
          success: true
        };
        
      } catch (queryError) {
        console.error('❌ Database insert failed:', queryError);
        throw queryError;
      }

      // 로그 기록 (하나의 통합된 로그)
      await connection.query(
        `INSERT INTO personal_data_logs 
         (chat_room_id, user_id, data_type, detected_value, confidence_score, action_taken) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          chatRoomId,
          userId,
          'schedule',
          `${integratedSchedule.title} (${integratedSchedule.date || '날짜미정'})`,
          scheduleData.confidence || 0.9,
          'encrypted'
        ]
      );

      await connection.commit();
      
      console.log(`✅ Integrated schedule saved successfully: ID ${result.insertId}`);
      return {
        id: result.insertId,
        success: true
      };

    } catch (error) {
      await connection.rollback();
      console.error('❌ Failed to save integrated schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // 날짜 문자열 파싱 (한국어 → DATE 형식)
  parseDateString(dateStr) {
    if (!dateStr) return null;

    try {
      // "4월 1일" 형식 처리
      const koreanMatch = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/);
      if (koreanMatch) {
        const month = parseInt(koreanMatch[1]);
        const day = parseInt(koreanMatch[2]);
        const year = new Date().getFullYear(); // 현재 연도 사용
        
        // 지난 날짜인 경우 다음 연도로 설정
        const date = new Date(year, month - 1, day);
        if (date < new Date()) {
          date.setFullYear(year + 1);
        }
        
        return date.toISOString().split('T')[0]; // YYYY-MM-DD 형식
      }

      // 일반적인 날짜 형식 시도
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }

    } catch (error) {
      console.warn('Date parsing failed:', dateStr, error.message);
    }

    return null;
  }

  // 시간 문자열 파싱
  parseTimeString(timeStr) {
    if (!timeStr) return null;

    try {
      // "14:00" 형식
      if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        return timeStr + ':00'; // HH:MM:SS 형식
      }

      // "오후 2시" 형식
      const koreanTimeMatch = timeStr.match(/(오전|오후)\s*(\d{1,2})시/);
      if (koreanTimeMatch) {
        const period = koreanTimeMatch[1];
        let hour = parseInt(koreanTimeMatch[2]);
        
        if (period === '오후' && hour !== 12) {
          hour += 12;
        } else if (period === '오전' && hour === 12) {
          hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:00:00`;
      }

      // "14시" 형식
      const hourMatch = timeStr.match(/(\d{1,2})시/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1]);
        return `${hour.toString().padStart(2, '0')}:00:00`;
      }

    } catch (error) {
      console.warn('Time parsing failed:', timeStr, error.message);
    }

    return null;
  }

  // 월별 일정 조회 (컬럼 존재 여부 대응)
  async getMonthlySchedules(userId, month, year = null) {
    try {
      const currentYear = year || new Date().getFullYear();
      
      // 새 컬럼 존재 여부 확인
      const [columns] = await pool.query(
        "SHOW COLUMNS FROM user_personal_data LIKE 'schedule_title'"
      );
      const hasNewColumns = columns.length > 0;
      
      let query, params;
      
      if (hasNewColumns) {
        // 새 컬럼이 있는 경우
        query = `
          SELECT id, schedule_title, schedule_date, schedule_time, schedule_location,
                 data_key, encrypted_value, context, iv, auth_tag, created_at
          FROM user_personal_data 
          WHERE user_id = ? 
            AND data_type = 'schedule'
            AND is_active = 1
            AND (
              (schedule_date IS NOT NULL AND MONTH(schedule_date) = ? AND YEAR(schedule_date) = ?)
              OR (schedule_date IS NULL AND (
                context->>'$.date' LIKE ? OR 
                context->>'$.schedule_date' LIKE ?
              ))
            )
          ORDER BY schedule_date ASC, schedule_time ASC, created_at ASC
        `;
        params = [userId, month, currentYear, `${month}월%`, `${currentYear}-${month.toString().padStart(2, '0')}%`];
      } else {
        // 기존 컬럼만 사용 (context에서 정보 추출)
        query = `
          SELECT id, data_key, encrypted_value, context, iv, auth_tag, created_at
          FROM user_personal_data 
          WHERE user_id = ? 
            AND data_type = 'schedule'
            AND is_active = 1
            AND (
              context->>'$.date' LIKE ? OR 
              context->>'$.schedule_date' LIKE ? OR
              JSON_EXTRACT(context, '$.schedule_date') LIKE ?
            )
          ORDER BY created_at ASC
        `;
        params = [userId, `${month}월%`, `${currentYear}-${month.toString().padStart(2, '0')}%`, `${currentYear}-${month.toString().padStart(2, '0')}%`];
      }

      const [rows] = await pool.query(query, params);
      
      console.log(`📅 Found ${rows.length} schedules for ${month}월 (${hasNewColumns ? 'new' : 'legacy'} format)`);
      
      if (rows.length === 0) {
        return `${month}월에 등록된 일정이 없습니다.`;
      }

      return this.formatMonthlySchedules(rows, month, hasNewColumns);

    } catch (error) {
      console.error('Error getting monthly schedules:', error);
      return `${month}월 일정을 불러오는 중 오류가 발생했습니다.`;
    }
  }

  // 월별 일정 포맷팅 (컬럼 존재 여부 대응)
  formatMonthlySchedules(schedules, month, hasNewColumns = true) {
    const monthNames = {
      1: '1월', 2: '2월', 3: '3월', 4: '4월', 5: '5월', 6: '6월',
      7: '7월', 8: '8월', 9: '9월', 10: '10월', 11: '11월', 12: '12월'
    };

    let result = `🗓️ ${monthNames[month]} 일정:\n\n`;

    // 날짜별로 그룹화
    const groupedByDate = {};
    
    schedules.forEach(schedule => {
      let dateKey = '날짜 미정';
      let title, time, location;
      
      if (hasNewColumns) {
        // 새 컬럼에서 정보 추출
        if (schedule.schedule_date) {
          const date = new Date(schedule.schedule_date);
          const day = date.getDate();
          const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
          const weekday = weekdays[date.getDay()];
          dateKey = `${month}월 ${day}일 (${weekday})`;
        }
        
        title = schedule.schedule_title || schedule.data_key || '일정';
        time = schedule.schedule_time;
        location = schedule.schedule_location;
      } else {
        // context에서 정보 추출
        try {
          const context = JSON.parse(schedule.context || '{}');
          
          if (context.schedule_date) {
            const date = new Date(context.schedule_date);
            if (!isNaN(date.getTime())) {
              const day = date.getDate();
              const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
              const weekday = weekdays[date.getDay()];
              dateKey = `${month}월 ${day}일 (${weekday})`;
            }
          } else if (context.date) {
            dateKey = context.date;
          }
          
          title = context.schedule_title || context.title || schedule.data_key || '일정';
          time = context.schedule_time || context.time;
          location = context.schedule_location || context.location;
        } catch (error) {
          console.warn('Context parsing failed:', error);
          title = schedule.data_key || '일정';
        }
      }

      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = [];
      }

      groupedByDate[dateKey].push({
        title: title,
        time: time,
        location: location,
        id: schedule.id
      });
    });

    // 날짜순 정렬 및 출력
    const sortedDates = Object.keys(groupedByDate).sort((a, b) => {
      if (a === '날짜 미정') return 1;
      if (b === '날짜 미정') return -1;
      
      const dayA = parseInt(a.match(/(\d+)일/)?.[1] || 0);
      const dayB = parseInt(b.match(/(\d+)일/)?.[1] || 0);
      return dayA - dayB;
    });

    sortedDates.forEach(dateKey => {
      result += `📅 ${dateKey}\n`;
      
      groupedByDate[dateKey].forEach((schedule, index) => {
        let scheduleText = `${index + 1}. ${schedule.title}`;
        
        if (schedule.time) {
          const timeStr = typeof schedule.time === 'string' ? 
            schedule.time.substring(0, 5) : schedule.time; // HH:MM 형식
          scheduleText += ` (${timeStr})`;
        }
        
        if (schedule.location) {
          scheduleText += ` - ${schedule.location}`;
        }
        
        result += `${scheduleText}\n`;
      });
      
      result += '\n';
    });

    return result.trim();
  }

  // 복수 일정 저장 (한 메시지에 여러 일정이 있는 경우)
  async saveMultipleSchedules(userId, chatRoomId, schedules, originalMessage) {
    const savedSchedules = [];
    
    for (const schedule of schedules) {
      try {
        const result = await this.saveIntegratedSchedule(userId, chatRoomId, schedule, originalMessage);
        savedSchedules.push({ ...schedule, savedId: result.id });
      } catch (error) {
        console.error('Failed to save schedule:', schedule, error);
      }
    }
    
    return savedSchedules;
  }
}

module.exports = ImprovedScheduleStorage;