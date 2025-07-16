// server/src/services/ImprovedScheduleStorage.js
const pool = require('../config/database');
const crypto = require('crypto');

class ImprovedScheduleStorage {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.masterKey = Buffer.from(process.env.ENCRYPTION_MASTER_KEY || crypto.randomBytes(32));
  }

  // 통합된 일정 저장
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

      // DB에 저장
      const query = `INSERT INTO user_personal_data 
               (user_id, chat_room_id, data_type, data_key, encrypted_value, 
                original_message, iv, auth_tag, context, confidence_score,
                schedule_title, schedule_date, schedule_time, schedule_location) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
               
      const params = [
        userId, chatRoomId, 'schedule', integratedSchedule.title,
        encryptedValue, originalMessage, iv, authTag,
        JSON.stringify(context), scheduleData.confidence || 0.9,
        integratedSchedule.title, parsedDate, parsedTime, integratedSchedule.location
      ];
      
      const [result] = await connection.query(query, params);
      
      console.log(`✅ Integrated schedule saved: ID ${result.insertId}`);

      // 로그 기록
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
      
      return {
        id: result.insertId,
        success: true,
        ...integratedSchedule
      };

    } catch (error) {
      await connection.rollback();
      console.error('❌ Failed to save integrated schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // 날짜 문자열 파싱 (한국어 → DATE 형식) - 수정된 버전
  parseDateString(dateStr) {
    if (!dateStr) return null;

    try {
      console.log('🔍 Parsing date string:', dateStr);
      
      // "6월 2일" 형식 처리
      const koreanMatch = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/);
      if (koreanMatch) {
        const month = parseInt(koreanMatch[1]);
        const day = parseInt(koreanMatch[2]);
        const currentYear = new Date().getFullYear(); // 2025
        const currentMonth = new Date().getMonth() + 1; // 현재 월 (1-12)
        const currentDay = new Date().getDate(); // 현재 일
        
        let targetYear = currentYear;
        
        // 더 똑똑한 연도 추론 로직
        if (month < currentMonth) {
          // 이전 월인 경우 다음 해로 설정 (예: 현재 7월, 입력 6월 → 2026년 6월)
          targetYear = currentYear + 1;
          console.log(`📅 Previous month detected (${month}월 < ${currentMonth}월), setting to ${targetYear}`);
        } else if (month === currentMonth && day < currentDay) {
          // 같은 월이지만 이전 일인 경우
          // 이 경우에는 사용자의 의도를 고려해서 현재 연도 유지 또는 다음 해 설정
          // 보통 일정 등록은 미래를 위한 것이므로 다음 해로 설정
          if (currentDay - day > 15) {
            // 15일 이상 차이나면 다음 해로 설정
            targetYear = currentYear + 1;
            console.log(`📅 Past date with significant gap (${day}일 < ${currentDay}일), setting to ${targetYear}`);
          } else {
            // 얼마 차이 안나면 현재 연도 유지 (사용자가 과거 일정을 기록할 수도 있음)
            console.log(`📅 Recent past date, keeping current year ${targetYear}`);
          }
        } else {
          // 미래 날짜인 경우 현재 연도 유지
          console.log(`📅 Future date detected, keeping current year ${targetYear}`);
        }
        
        const finalDate = `${targetYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        console.log(`✅ Parsed date: ${dateStr} → ${finalDate}`);
        return finalDate;
      }

      // "2025-07-01" 같은 ISO 형식
      const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (isoMatch) {
        const year = parseInt(isoMatch[1]);
        const month = parseInt(isoMatch[2]);
        const day = parseInt(isoMatch[3]);
        const finalDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        console.log(`✅ Parsed ISO date: ${dateStr} → ${finalDate}`);
        return finalDate;
      }

      // 일반적인 날짜 형식 시도
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const finalDate = date.toISOString().split('T')[0];
        console.log(`✅ Parsed generic date: ${dateStr} → ${finalDate}`);
        return finalDate;
      }

      console.warn('⚠️ Could not parse date:', dateStr);
      return null;

    } catch (error) {
      console.warn('❌ Date parsing failed:', dateStr, error.message);
      return null;
    }
  }

  // 시간 문자열 파싱
  parseTimeString(timeStr) {
    if (!timeStr) return null;

    try {
      console.log('🕐 Parsing time string:', timeStr);
      
      // "14:00" 형식
      if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        const result = timeStr + ':00'; // HH:MM:SS 형식
        console.log(`✅ Parsed time: ${timeStr} → ${result}`);
        return result;
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
        
        const result = `${hour.toString().padStart(2, '0')}:00:00`;
        console.log(`✅ Parsed Korean time: ${timeStr} → ${result}`);
        return result;
      }

      // "14시" 형식
      const hourMatch = timeStr.match(/(\d{1,2})시/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1]);
        const result = `${hour.toString().padStart(2, '0')}:00:00`;
        console.log(`✅ Parsed hour: ${timeStr} → ${result}`);
        return result;
      }

      console.warn('⚠️ Could not parse time:', timeStr);
      return null;

    } catch (error) {
      console.warn('❌ Time parsing failed:', timeStr, error.message);
      return null;
    }
  }

  // 월별 일정 조회
  async getMonthlySchedules(userId, month, year = null) {
    try {
      const currentYear = year || new Date().getFullYear();
      
      const query = `
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
              data_key LIKE ?
            ))
          )
        ORDER BY schedule_date ASC, schedule_time ASC, created_at ASC
      `;
      
      const params = [
        userId, 
        month, 
        currentYear, 
        `${month}월%`, 
        `%${month}월%`
      ];

      const [rows] = await pool.query(query, params);
      
      console.log(`📅 Found ${rows.length} schedules for ${month}월 ${currentYear}년`);
      
      if (rows.length === 0) {
        return `${month}월에 등록된 일정이 없습니다.`;
      }

      return this.formatMonthlySchedules(rows, month);

    } catch (error) {
      console.error('Error getting monthly schedules:', error);
      return `${month}월 일정을 불러오는 중 오류가 발생했습니다.`;
    }
  }

  // 월별 일정 포맷팅
  formatMonthlySchedules(schedules, month) {
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
      
      // schedule_date가 있는 경우 우선 사용
      if (schedule.schedule_date) {
        const date = new Date(schedule.schedule_date);
        const day = date.getDate();
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const weekday = weekdays[date.getDay()];
        dateKey = `${month}월 ${day}일 (${weekday})`;
      } else {
        // context나 data_key에서 날짜 추출 시도
        try {
          const context = JSON.parse(schedule.context || '{}');
          if (context.date && context.date.includes(`${month}월`)) {
            dateKey = context.date;
          }
        } catch (error) {
          console.warn('Context parsing failed:', error);
        }
      }
      
      title = schedule.schedule_title || schedule.data_key || '일정';
      time = schedule.schedule_time;
      location = schedule.schedule_location;

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

  // 복수 일정 저장
  async saveMultipleSchedules(userId, chatRoomId, schedules, originalMessage) {
    const savedSchedules = [];
    
    for (const schedule of schedules) {
      try {
        const result = await this.saveIntegratedSchedule(userId, chatRoomId, schedule, originalMessage);
        savedSchedules.push(result);
      } catch (error) {
        console.error('Failed to save schedule:', schedule, error);
      }
    }
    
    return savedSchedules;
  }
}

module.exports = ImprovedScheduleStorage;