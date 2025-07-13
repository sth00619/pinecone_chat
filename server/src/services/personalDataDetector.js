const pool = require('../config/database');

class PersonalDataDetector {
  constructor() {
    this.patterns = {
      email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/gi,
      phone: /(010|011|016|017|018|019)[-\s]?[0-9]{3,4}[-\s]?[0-9]{4}/g,
      birthday: /(\d{4}[-/년]\s?\d{1,2}[-/월]\s?\d{1,2}[일]?)|(\d{2}[-/]\d{2}[-/]\d{2})/g,
      ssn: /\d{6}[-\s]?\d{7}/g,
      address: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[\s\S]{0,50}(시|도)[\s\S]{0,30}(구|군)[\s\S]{0,30}(로|길)/g,
      creditCard: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g,
      studentId: /\d{7,10}/g
    };
  }

  async detect(text, userId = null, chatRoomId = null) {
    const detectedData = {
      hasPersonalData: false,
      detectedTypes: [],
      data: {},
      logs: []
    };

    // 각 패턴별로 검사
    for (const [type, pattern] of Object.entries(this.patterns)) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        detectedData.hasPersonalData = true;
        detectedData.detectedTypes.push(type);
        detectedData.data[type] = matches[0]; // 첫 번째 매칭만 저장

        // 로그 데이터 준비
        detectedData.logs.push({
          data_type: type,
          detected_value: matches[0],
          confidence_score: this.getConfidenceScore(type, matches[0]),
          action_taken: 'logged'
        });
      }
    }

    // DB에 로그 저장
    if (detectedData.hasPersonalData && chatRoomId) {
      await this.saveToDatabase(detectedData, userId, chatRoomId);
    }

    return detectedData;
  }

  getConfidenceScore(type, value) {
    const scores = {
      email: 0.95,
      phone: 0.90,
      ssn: 0.95,
      creditCard: 0.85,
      birthday: 0.80,
      address: 0.75,
      studentId: 0.70
    };
    return scores[type] || 0.50;
  }

  async saveToDatabase(detectedData, userId, chatRoomId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const log of detectedData.logs) {
        await connection.query(
          `INSERT INTO personal_data_logs 
           (chat_room_id, user_id, data_type, detected_value, confidence_score, action_taken) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [chatRoomId, userId, log.data_type, log.detected_value, log.confidence_score, log.action_taken]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = PersonalDataDetector;