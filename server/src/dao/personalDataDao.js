const pool = require('../config/database');
const crypto = require('crypto');

class PersonalDataDao {
  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
    this.algorithm = 'aes-256-gcm';
  }

  // Missing Implementation 5: Enhanced Context Detection
  detectPersonalDataWithContext(text) {
    const results = this.detectPersonalDataType(text);
    
    // Enhanced context analysis
    const contextKeywords = {
      student_id: ['학번', 'student', 'id', 'number', '번호', '학과', '전공', 'department'],
      phone: ['전화', 'phone', 'call', '연락', 'contact', '핸드폰', 'mobile'],
      email: ['이메일', 'email', 'mail', '@', '메일', 'contact'],
      address: ['주소', 'address', '집', 'home', '거주', 'live', '사는곳'],
      schedule: ['약속', 'meeting', '만남', '일정', 'schedule', '시간', 'time']
    };
    
    // Improve confidence based on context
    results.forEach(item => {
      const keywords = contextKeywords[item.type] || [];
      const contextScore = this.calculateContextScore(text, keywords);
      item.confidence = Math.min(0.95, item.confidence + contextScore * 0.2);
    });
    
    return results.filter(item => item.confidence >= 0.6);
  }

  calculateContextScore(text, keywords) {
    const lowerText = text.toLowerCase();
    let score = 0;
    
    keywords.forEach(keyword => {
      if (lowerText.includes(keyword.toLowerCase())) {
        score += 0.1;
      }
    });
    
    return Math.min(1.0, score);
  }

  // Missing Implementation 2: Enhanced student ID detection
  detectAdvancedStudentId(text) {
    const patterns = [
      // University-specific patterns
      /\b(?:ST|st|Student|student)[-_]?(\d{6,12})\b/g,
      /\b(\d{4})[-_]?(\d{6,8})\b/g, // Year + number
      /\b([A-Z]{2,4})[-_]?(\d{6,10})\b/g, // Department code + number
      
      // Context-based detection
      /\b(?:학번|student\s*(?:id|number)|번호)[:：\s]*([A-Z0-9-_]{6,15})/gi,
      /\b(?:I\s*am|my\s*(?:student\s*)?(?:id|number)\s*is)[:：\s]*([A-Z0-9-_]{6,15})/gi,
      
      // Korean university patterns
      /\b(\d{2})학번\s*(\d{6,8})\b/g, // "19학번 20191234"
      /\b(\d{4})학년도\s*입학\s*(\d{6,8})\b/g,
      
      // International patterns
      /\b(?:matric|registration)[:：\s]*([A-Z0-9-_]{6,15})/gi
    ];
    
    return this.detectWithContext(text, patterns, 'student_id');
  }

  // 패턴과 컨텍스트를 함께 고려한 감지 함수
  detectWithContext(text, patterns, dataType) {
    const results = [];
    const lowerText = text.toLowerCase();
    
    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleaned = match.replace(/[^A-Z0-9]/gi, '');
          if (cleaned.length >= 6 && cleaned.length <= 15) {
            // 컨텍스트 키워드 확인
            const contextKeywords = {
              student_id: ['학번', 'student', 'id', 'number', '번호', '학과', '전공', 'department', 'matric', 'registration']
            };
            
            const keywords = contextKeywords[dataType] || [];
            const hasContext = keywords.some(keyword => 
              lowerText.includes(keyword.toLowerCase())
            );
            
            const confidence = hasContext ? 0.9 : 0.6;
            results.push({ type: dataType, value: cleaned, confidence });
          }
        });
      }
    });
    
    return results;
  }

  // 강화된 개인정보 감지 함수 (기존 + 새로운 패턴)
  detectPersonalDataType(text) {
    const detectedData = [];
    
    // 1. 이메일 패턴 (더 정확한)
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = text.match(emailPattern);
    if (emails) {
      emails.forEach(email => {
        detectedData.push({ type: 'email', value: email, confidence: 0.9 });
      });
    }

    // 2. 전화번호 패턴 (한국 번호 포함)
    const phonePatterns = [
      /\b(?:\+82-?|0)(?:10|11|16|17|18|19)-?\d{3,4}-?\d{4}\b/g, // 한국 휴대폰
      /\b(?:\+82-?|0)(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4])-?\d{3,4}-?\d{4}\b/g, // 한국 일반전화
      /\b\d{3}-\d{3}-\d{4}\b/g, // 미국식
      /\b\d{3}\.\d{3}\.\d{4}\b/g // 점으로 구분
    ];
    
    phonePatterns.forEach(pattern => {
      const phones = text.match(pattern);
      if (phones) {
        phones.forEach(phone => {
          detectedData.push({ type: 'phone', value: phone, confidence: 0.85 });
        });
      }
    });

    // 3. 생년월일 패턴 (다양한 형식)
    const birthdayPatterns = [
      /\b(?:19|20)\d{2}[년\-\/\.]\s?(?:0?[1-9]|1[0-2])[월\-\/\.]\s?(?:0?[1-9]|[12][0-9]|3[01])[일]?\b/g, // 한국식
      /\b(?:0?[1-9]|1[0-2])[\/\-\.]\s?(?:0?[1-9]|[12][0-9]|3[01])[\/\-\.]\s?(?:19|20)\d{2}\b/g, // MM/DD/YYYY
      /\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-\.]\s?(?:0?[1-9]|1[0-2])[\/\-\.]\s?(?:19|20)\d{2}\b/g, // DD/MM/YYYY
      /\b(?:19|20)\d{2}[\/\-\.]\s?(?:0?[1-9]|1[0-2])[\/\-\.]\s?(?:0?[1-9]|[12][0-9]|3[01])\b/g // YYYY/MM/DD
    ];
    
    birthdayPatterns.forEach(pattern => {
      const birthdays = text.match(pattern);
      if (birthdays) {
        birthdays.forEach(birthday => {
          detectedData.push({ type: 'birthday', value: birthday, confidence: 0.8 });
        });
      }
    });

    // 4. 주소 패턴 (한국 주소)
    const addressPatterns = [
      /\b(?:서울|부산|대구|인천|광주|대전|울산|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|도)?\s*[\w\s\-동구시군로길]+\d+/g,
      /\b\d{5}(?:-\d{4})?\s+[\w\s]+(?:동|로|길)\s*\d+/g // 우편번호 포함
    ];
    
    addressPatterns.forEach(pattern => {
      const addresses = text.match(pattern);
      if (addresses) {
        addresses.forEach(address => {
          detectedData.push({ type: 'address', value: address, confidence: 0.75 });
        });
      }
    });

    // 5. 학번 패턴 (강화된 버전 사용)
    const studentIdResults = this.detectAdvancedStudentId(text);
    detectedData.push(...studentIdResults);

    // 6. 주민등록번호 패턴
    const residencePatterns = [
      /\b\d{6}[-\s]?[1-4]\d{6}\b/g, // 123456-1234567
      /\b(?:주민|등록|번호)[:：\s]*(\d{6}[-\s]?[1-4]\d{6})\b/gi
    ];
    
    residencePatterns.forEach(pattern => {
      const residences = text.match(pattern);
      if (residences) {
        residences.forEach(residence => {
          detectedData.push({ type: 'residence_number', value: residence, confidence: 0.95 });
        });
      }
    });

    // 7. 비밀번호 패턴
    const passwordPatterns = [
      /\b(?:password|pwd|비밀번호|패스워드)[:：\s]*([A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~]+)\b/gi,
      /\b(?:비번|암호)[:：\s]*([A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~]+)\b/gi
    ];
    
    passwordPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const parts = match.split(/[:：\s]+/);
          const cleanPassword = parts[parts.length - 1];
          if (cleanPassword && cleanPassword.length >= 4) {
            detectedData.push({ type: 'password', value: cleanPassword, confidence: 0.85 });
          }
        });
      }
    });

    // 8. 인증코드/확인코드 패턴
    const codePatterns = [
      /\b(?:code|코드|인증|확인)[:：\s]*([A-Z0-9]{4,10})\b/gi,
      /\b(?:verification|verify)[:：\s]*([A-Z0-9]{4,10})\b/gi,
      /\b([A-Z0-9]{4,6})\s*(?:코드|code)\b/gi
    ];
    
    codePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleanCode = match.replace(/[^A-Z0-9]/gi, '');
          if (cleanCode.length >= 4 && cleanCode.length <= 10) {
            detectedData.push({ type: 'code', value: cleanCode, confidence: 0.7 });
          }
        });
      }
    });

    // 9. 일정/약속 패턴
    const schedulePatterns = [
      /\b(?:내일|오늘|모레|다음주|이번주|다음달|이번달)\s*\d{1,2}[시:\s]*\d{0,2}[분]?\s*(?:에|부터|까지)?\s*[\w\s]+/g,
      /\b\d{1,2}월\s*\d{1,2}일\s*\d{1,2}[시:\s]*\d{0,2}[분]?\s*[\w\s]+/g,
      /\b\d{1,2}\/\d{1,2}\s*\d{1,2}:\d{2}\s*[\w\s]+/g
    ];
    
    schedulePatterns.forEach(pattern => {
      const schedules = text.match(pattern);
      if (schedules) {
        schedules.forEach(schedule => {
          detectedData.push({ type: 'schedule', value: schedule, confidence: 0.6 });
        });
      }
    });

    // 10. 암시적 개인정보 패턴
    const implicitPatterns = [
      /\b(?:나는|저는|내가|제가)\s*[\w\s]*(?:살|거주|산다|살고있다)/gi, // 거주지 관련
      /\b(?:my|내|제)\s*(?:name|이름)[:：\s]*([가-힣A-Za-z\s]+)/gi, // 이름
      /\b(?:나이|age)[:：\s]*(\d{1,3})/gi // 나이
    ];
    
    implicitPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          detectedData.push({ type: 'personal_info', value: match, confidence: 0.5 });
        });
      }
    });

    // 중복 제거 및 신뢰도 기준 필터링
    const uniqueData = [];
    const seen = new Set();
    
    detectedData.forEach(item => {
      const key = `${item.type}-${item.value}`;
      if (!seen.has(key) && item.confidence >= 0.5) {
        seen.add(key);
        uniqueData.push(item);
      }
    });

    return uniqueData;
  }

  // 데이터 암호화
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  // 데이터 복호화
  decrypt(encryptedData) {
    try {
      const decipher = crypto.createDecipher(
        this.algorithm, 
        this.encryptionKey, 
        Buffer.from(encryptedData.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return '[암호화된 데이터]';
    }
  }

  // 개인정보 저장
  async savePersonalData(userId, dataType, dataValue, context = {}) {
    try {
      // 데이터 암호화
      const encryptedData = this.encrypt(dataValue);
      
      // 만료 시간 설정 (기본 30일)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      const query = `
        INSERT INTO user_personal_data 
        (user_id, data_type, encrypted_value, iv, auth_tag, context, confidence_score, expires_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await pool.query(query, [
        userId,
        dataType,
        encryptedData.encrypted,
        encryptedData.iv,
        encryptedData.authTag,
        JSON.stringify(context),
        context.confidence || 0.5,
        expiresAt
      ]);
      
      return result.insertId;
    } catch (error) {
      console.error('Error saving personal data:', error);
      throw error;
    }
  }

  // 사용자 개인정보 조회
  async getUserPersonalData(userId) {
    try {
      const query = `
        SELECT id, data_type, encrypted_value, iv, auth_tag, context, 
               confidence_score, expires_at, created_at 
        FROM user_personal_data 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
      `;
      
      const [rows] = await pool.query(query, [userId]);
      
      return rows.map(row => ({
        id: row.id,
        dataType: row.data_type,
        value: this.decrypt({
          encrypted: row.encrypted_value,
          iv: row.iv,
          authTag: row.auth_tag
        }),
        context: JSON.parse(row.context || '{}'),
        confidence: row.confidence_score,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('Error fetching user personal data:', error);
      throw error;
    }
  }

  // 특정 개인정보 조회
  async getPersonalDataById(dataId) {
    try {
      const query = `
        SELECT user_id, data_type, encrypted_value, iv, auth_tag, context, 
               confidence_score, expires_at, created_at 
        FROM user_personal_data 
        WHERE id = ?
      `;
      
      const [rows] = await pool.query(query, [dataId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const row = rows[0];
      return {
        user_id: row.user_id,
        dataType: row.data_type,
        value: this.decrypt({
          encrypted: row.encrypted_value,
          iv: row.iv,
          authTag: row.auth_tag
        }),
        context: JSON.parse(row.context || '{}'),
        confidence: row.confidence_score,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      };
    } catch (error) {
      console.error('Error fetching personal data by ID:', error);
      throw error;
    }
  }

  // 개인정보 삭제
  async deletePersonalData(dataId) {
    try {
      const query = 'DELETE FROM user_personal_data WHERE id = ?';
      const [result] = await pool.query(query, [dataId]);
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting personal data:', error);
      throw error;
    }
  }

  // 만료 시간 설정
  async setExpiration(dataId, expireAt) {
    try {
      const query = 'UPDATE user_personal_data SET expires_at = ? WHERE id = ?';
      const [result] = await pool.query(query, [expireAt, dataId]);
      return result.affectedRows;
    } catch (error) {
      console.error('Error setting expiration:', error);
      throw error;
    }
  }

  // 만료된 데이터 정리 (크론잡에서 사용)
  async cleanupExpiredData() {
    try {
      const query = 'DELETE FROM user_personal_data WHERE expires_at <= NOW()';
      const [result] = await pool.query(query);
      console.log(`Cleaned up ${result.affectedRows} expired personal data records`);
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up expired data:', error);
      throw error;
    }
  }

  // 사용자별 개인정보 통계
  async getPersonalDataStats(userId) {
    try {
      const query = `
        SELECT 
          data_type,
          COUNT(*) as count,
          AVG(confidence_score) as avg_confidence,
          MIN(created_at) as first_detected,
          MAX(created_at) as last_detected
        FROM user_personal_data 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())
        GROUP BY data_type
      `;
      
      const [rows] = await pool.query(query, [userId]);
      return rows;
    } catch (error) {
      console.error('Error fetching personal data stats:', error);
      throw error;
    }
  }

  // 전체 시스템 개인정보 통계 (관리자용)
  async getSystemPersonalDataStats() {
    try {
      const query = `
        SELECT 
          data_type,
          COUNT(*) as total_count,
          COUNT(DISTINCT user_id) as unique_users,
          AVG(confidence_score) as avg_confidence,
          COUNT(CASE WHEN expires_at <= NOW() THEN 1 END) as expired_count
        FROM user_personal_data 
        GROUP BY data_type
      `;
      
      const [rows] = await pool.query(query);
      return rows;
    } catch (error) {
      console.error('Error fetching system personal data stats:', error);
      throw error;
    }
  }
}

module.exports = new PersonalDataDao();