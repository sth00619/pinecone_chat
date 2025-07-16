// server/src/services/EncryptionService.js
const crypto = require('crypto');
const pool = require('../config/database');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.masterKey = Buffer.from(process.env.ENCRYPTION_MASTER_KEY || crypto.randomBytes(32));
  }

  // 데이터가 암호화되었는지 확인하는 함수
  isEncrypted(data, iv = null, authTag = null) {
    // iv와 auth_tag가 모두 있고 비어있지 않으면 암호화된 데이터
    if (iv && authTag && iv.trim() !== '' && authTag.trim() !== '') {
      return true;
    }
    
    // 긴 hex 문자열이면 암호화된 데이터일 가능성
    if (typeof data === 'string' && data.length > 32 && /^[a-f0-9]+$/i.test(data)) {
      return true;
    }
    
    return false;
  }

  // 평문 데이터인지 확인
  isPlainText(dataKey, encryptedValue) {
    // data_key가 있고 encrypted_value가 짧으면 평문 데이터
    return dataKey && encryptedValue && encryptedValue.length < 100;
  }

  async encryptPersonalData(userId, dataType, plainText, context = {}) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // DB에 저장
    const [result] = await pool.query(
      `INSERT INTO user_personal_data 
       (user_id, data_type, encrypted_value, iv, auth_tag, context, confidence_score) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        dataType,
        encrypted,
        iv.toString('hex'),
        authTag.toString('hex'),
        JSON.stringify(context),
        0.95
      ]
    );
    
    return {
      id: result.insertId,
      encrypted: true
    };
  }

  async decryptPersonalData(encryptedData) {
    try {
      // 필수 필드 검증
      if (!encryptedData.iv || !encryptedData.auth_tag || !encryptedData.encrypted_value) {
        throw new Error('Missing required encryption fields');
      }

      // 빈 값 체크
      if (encryptedData.iv.trim() === '' || encryptedData.auth_tag.trim() === '' || encryptedData.encrypted_value.trim() === '') {
        throw new Error('Empty encryption fields');
      }

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.masterKey,
        Buffer.from(encryptedData.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(encryptedData.auth_tag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted_value, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error.message);
      throw error;
    }
  }

  // 유연한 데이터 파싱 함수 (async 추가)
  async parseRowData(row) {
    try {
      // 1. 암호화된 데이터 처리
      if (this.isEncrypted(row.encrypted_value, row.iv, row.auth_tag)) {
        try {
          const decrypted = await this.decryptPersonalData(row);
          return {
            id: row.id,
            dataType: row.data_type,
            key: null,
            value: decrypted,
            context: this.parseContext(row.context),
            createdAt: row.created_at,
            chatRoomId: row.chat_room_id,
            source: 'encrypted'
          };
        } catch (error) {
          console.error(`Decryption failed for row ${row.id}:`, error.message);
          // 복호화 실패 시 null 반환하지 말고 원본 데이터로 처리
          return {
            id: row.id,
            dataType: row.data_type,
            key: row.data_key,
            value: row.encrypted_value,
            context: this.parseContext(row.context),
            createdAt: row.created_at,
            chatRoomId: row.chat_room_id,
            source: 'decryption_failed'
          };
        }
      }
      
      // 2. 평문 데이터 처리 (data_key + encrypted_value 조합)
      if (this.isPlainText(row.data_key, row.encrypted_value)) {
        return {
          id: row.id,
          dataType: row.data_type,
          key: row.data_key,
          value: row.encrypted_value,
          context: this.parseContext(row.context),
          createdAt: row.created_at,
          chatRoomId: row.chat_room_id,
          source: 'plaintext'
        };
      }
      
      // 3. encrypted_value만 있는 경우 (평문일 수도 있음)
      if (row.encrypted_value) {
        return {
          id: row.id,
          dataType: row.data_type,
          key: row.data_key,
          value: row.encrypted_value,
          context: this.parseContext(row.context),
          createdAt: row.created_at,
          chatRoomId: row.chat_room_id,
          source: 'unknown'
        };
      }
      
      console.warn(`Unable to parse row ${row.id}: no valid data found`);
      return null;
      
    } catch (error) {
      console.error(`Row parsing failed for ${row.id}:`, error.message);
      return null;
    }
  }

  // 컨텍스트 안전 파싱
  parseContext(contextString) {
    if (!contextString) return {};
    
    try {
      if (typeof contextString === 'string') {
        return JSON.parse(contextString);
      }
      return contextString;
    } catch (error) {
      console.warn('Context parsing failed:', error.message);
      return {};
    }
  }

  async getUserPersonalData(userId, dataType = null) {
    let query = 'SELECT * FROM user_personal_data WHERE user_id = ?';
    const params = [userId];
    
    if (dataType) {
      query += ' AND data_type = ?';
      params.push(dataType);
    }
    
    query += ' ORDER BY created_at DESC';
    
    try {
      const [rows] = await pool.query(query, params);
      console.log(`📊 Retrieved ${rows.length} raw rows for user ${userId}`);
      
      // 각 행을 비동기적으로 파싱하고 null이 아닌 것만 반환
      const parsedDataPromises = rows.map(row => this.parseRowData(row));
      const parsedDataResults = await Promise.all(parsedDataPromises);
      const parsedData = parsedDataResults.filter(data => data !== null);
      
      console.log(`✅ Successfully parsed ${parsedData.length} rows`);
      return parsedData;
      
    } catch (error) {
      console.error('Database query failed:', error);
      throw error;
    }
  }

  // 스케줄 데이터 특화 처리
  async getScheduleData(userId, month = null) {
    try {
      const personalData = await this.getUserPersonalData(userId, 'schedule');
      
      // 비동기적으로 스케줄 데이터 포맷팅
      const schedulePromises = personalData.map(data => this.formatScheduleData(data));
      const scheduleResults = await Promise.all(schedulePromises);
      const schedules = scheduleResults.filter(schedule => schedule !== null);
      
      // 월별 필터링
      if (month) {
        return schedules.filter(schedule => {
          const scheduleMonth = this.extractMonth(schedule);
          return scheduleMonth === month;
        });
      }
      
      return schedules;
    } catch (error) {
      console.error('Schedule data retrieval failed:', error);
      return [];
    }
  }

  // 스케줄 데이터 포맷팅 (개선된 버전)
  formatScheduleData(data) {
    try {
      let title, date, time;
      
      console.log('🔧 Formatting schedule data:', {
        id: data.id,
        source: data.source,
        key: data.key,
        value: data.value,
        context: data.context
      });
      
      if (data.source === 'plaintext') {
        // 평문 데이터의 경우
        if (data.key && data.key !== 'NULL') {
          title = data.key;
          // value에서 추가 정보 추출 시도
          if (data.value && data.value !== '1' && data.value !== 'NULL') {
            title += ` - ${data.value}`;
          }
        } else {
          title = data.value || '제목 없음';
        }
      } else {
        // 암호화된 데이터나 기타 데이터
        try {
          const parsedValue = JSON.parse(data.value);
          title = parsedValue.title || parsedValue.name || parsedValue.event;
          date = parsedValue.date || parsedValue.start_date;
          time = parsedValue.time || parsedValue.start_time;
        } catch {
          // JSON이 아닌 경우 그대로 사용
          title = data.value;
        }
      }
      
      // 컨텍스트에서 추가 정보 추출
      if (data.context) {
        date = date || data.context.date || data.context.datetime;
        time = time || data.context.time;
        
        // 컨텍스트에서 날짜/시간 정보 파싱
        if (data.context.datetime) {
          const datetimeStr = data.context.datetime;
          // "12월 1일" 같은 형식 추출
          const koreanDateMatch = datetimeStr.match(/(\d{1,2}월\s*\d{1,2}일)/);
          if (koreanDateMatch) {
            date = koreanDateMatch[1];
          }
        }
      }
      
      const formattedData = {
        id: data.id,
        title: title || '제목 없음',
        date: date,
        time: time,
        chatRoomId: data.chatRoomId,
        createdAt: data.createdAt
      };
      
      console.log('✅ Formatted schedule:', formattedData);
      return formattedData;
      
    } catch (error) {
      console.error('Schedule formatting failed:', error);
      return null;
    }
  }

  // 월 추출 함수 (개선된 버전)
  extractMonth(schedule) {
    console.log('🔍 Extracting month from schedule:', {
      id: schedule.id,
      title: schedule.title,
      date: schedule.date,
      createdAt: schedule.createdAt
    });

    // 1. 명시적인 날짜 필드에서 추출
    if (schedule.date) {
      try {
        // 다양한 날짜 형식 처리
        let dateObj;
        
        // "12월 1일" 형식 처리
        const koreanDateMatch = schedule.date.match(/(\d{1,2})월\s*(\d{1,2})일/);
        if (koreanDateMatch) {
          const month = parseInt(koreanDateMatch[1]);
          console.log(`✅ Found Korean date format: ${month}월`);
          return month;
        }
        
        // 일반적인 날짜 형식 시도
        dateObj = new Date(schedule.date);
        if (!isNaN(dateObj.getTime())) {
          const month = dateObj.getMonth() + 1;
          console.log(`✅ Found date: ${schedule.date} -> month: ${month}`);
          return month;
        }
      } catch (error) {
        console.warn(`Date parsing failed for: ${schedule.date}`, error.message);
      }
    }

    // 2. 제목에서 월 정보 찾기
    if (schedule.title) {
      const monthMatch = schedule.title.match(/(\d{1,2})월/);
      if (monthMatch) {
        const month = parseInt(monthMatch[1]);
        console.log(`✅ Found month in title: ${schedule.title} -> ${month}월`);
        return month;
      }
    }
    
    // 3. createdAt에서 월 추출 (마지막 수단)
    if (schedule.createdAt) {
      try {
        const date = new Date(schedule.createdAt);
        if (!isNaN(date.getTime())) {
          const month = date.getMonth() + 1;
          console.log(`⚠️ Using createdAt month: ${month}`);
          return month;
        }
      } catch (error) {
        console.warn(`CreatedAt parsing failed:`, error.message);
      }
    }
    
    console.log(`❌ No month found for schedule:`, schedule);
    return null;
  }

  // 8월 일정 특화 함수
  async getAugustSchedules(userId) {
    try {
      const schedules = await this.getScheduleData(userId, 8);
      
      if (schedules.length === 0) {
        return "8월에 등록된 일정이 없습니다.";
      }
      
      // 날짜별로 그룹화
      const groupedSchedules = {};
      schedules.forEach(schedule => {
        const dateKey = schedule.date || '날짜 미정';
        if (!groupedSchedules[dateKey]) {
          groupedSchedules[dateKey] = [];
        }
        groupedSchedules[dateKey].push(schedule);
      });
      
      // 포맷팅된 문자열 생성
      let result = "🗓️ 8월 일정:\n\n";
      
      Object.keys(groupedSchedules).sort().forEach(dateKey => {
        if (dateKey !== '날짜 미정') {
          try {
            const date = new Date(dateKey);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
            const weekday = weekdays[date.getDay()];
            result += `📅 ${month}월 ${day}일 (${weekday})\n`;
          } catch {
            result += `📅 ${dateKey}\n`;
          }
        } else {
          result += `📅 ${dateKey}\n`;
        }
        
        groupedSchedules[dateKey].forEach((schedule, index) => {
          const timeStr = schedule.time ? ` (${schedule.time})` : '';
          result += `${index + 1}. ${schedule.title}${timeStr}\n`;
        });
        result += '\n';
      });
      
      return result;
    } catch (error) {
      console.error('August schedules retrieval failed:', error);
      return "8월 일정을 불러오는 중 오류가 발생했습니다.";
    }
  }
}

module.exports = EncryptionService;