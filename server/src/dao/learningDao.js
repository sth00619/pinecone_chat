// server/src/dao/learningDao.js
const pool = require('../config/database');

class LearningDao {
  // 학습 큐에 항목 추가
  async addToLearningQueue(data) {
    try {
      const {
        chat_analytics_id,
        user_message,
        bot_response,
        response_source,
        confidence_score,
        user_feedback,
        priority = 5
      } = data;

      const query = `
        INSERT INTO learning_queue 
        (chat_analytics_id, user_message, bot_response, response_source, 
         confidence_score, user_feedback, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const [result] = await pool.query(query, [
        chat_analytics_id,
        user_message,
        bot_response,
        response_source,
        confidence_score,
        user_feedback,
        priority
      ]);

      return result.insertId;
    } catch (error) {
      console.error('Error adding to learning queue:', error);
      throw error;
    }
  }

  // 처리 대기 중인 학습 항목 가져오기
  async getPendingLearningItems(limit = 10) {
    try {
      const query = `
        SELECT * FROM learning_queue 
        WHERE processing_status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `;

      const [rows] = await pool.query(query, [limit]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting pending learning items:', error);
      return [];
    }
  }

  // 학습 항목 상태 업데이트
  async updateLearningStatus(id, status) {
    try {
      const query = `
        UPDATE learning_queue 
        SET processing_status = ?, processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const [result] = await pool.query(query, [status, id]);
      return result.affectedRows;
    } catch (error) {
      console.error('Error updating learning status:', error);
      return 0;
    }
  }

  // 사용자 피드백 저장
  async saveUserFeedback(messageId, userId, feedbackType, feedbackText = null) {
    try {
      const query = `
        INSERT INTO user_feedback (message_id, user_id, feedback_type, feedback_text)
        VALUES (?, ?, ?, ?)
      `;

      const [result] = await pool.query(query, [
        messageId, userId, feedbackType, feedbackText
      ]);

      return result.insertId;
    } catch (error) {
      console.error('Error saving user feedback:', error);
      throw error;
    }
  }

  // 메시지에 대한 피드백 통계
  async getFeedbackStats(messageId) {
    try {
      const query = `
        SELECT 
          feedback_type,
          COUNT(*) as count
        FROM user_feedback
        WHERE message_id = ?
        GROUP BY feedback_type
      `;

      const [rows] = await pool.query(query, [messageId]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting feedback stats:', error);
      return [];
    }
  }

  // 최적화 기록 저장
  async saveOptimization(data) {
    try {
      const {
        original_question,
        original_answer,
        optimized_answer,
        optimization_reason,
        improvement_score
      } = data;

      const query = `
        INSERT INTO answer_optimizations 
        (original_question, original_answer, optimized_answer, 
         optimization_reason, improvement_score)
        VALUES (?, ?, ?, ?, ?)
      `;

      const [result] = await pool.query(query, [
        original_question,
        original_answer,
        optimized_answer,
        optimization_reason,
        improvement_score
      ]);

      return result.insertId;
    } catch (error) {
      console.error('Error saving optimization:', error);
      throw error;
    }
  }

  // 유사 질문 그룹핑을 위한 분석 - GROUP BY 오류 수정
  async getQuestionPatterns(timeframe = 7) {
    const query = `
      SELECT 
        user_message,
        bot_response,
        matched_knowledge_id,
        AVG(response_time_ms) as avg_response_time_ms,  -- 집계 함수 사용
        COUNT(*) as frequency,
        AVG(CASE WHEN user_feedback IS NOT NULL THEN user_feedback ELSE 3 END) as avg_feedback
      FROM chat_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY user_message, bot_response, matched_knowledge_id
      HAVING frequency > 1
      ORDER BY frequency DESC
      LIMIT 100
    `;

    try {
      const [rows] = await pool.query(query, [timeframe]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error in getQuestionPatterns:', error);
      return [];
    }
  }

  // 성능 최적화를 위한 쿼리 - GROUP BY 오류 수정
  async getLowPerformanceAnswers() {
    const query = `
      SELECT 
        user_message,
        bot_response,
        matched_knowledge_id,
        AVG(response_time_ms) as avg_response_time,
        AVG(CASE WHEN user_feedback IS NOT NULL THEN user_feedback ELSE 3 END) as avg_feedback,
        COUNT(*) as frequency
      FROM chat_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND (
          response_time_ms > 3000 
          OR user_feedback < 3
        )
      GROUP BY user_message, bot_response, matched_knowledge_id
      HAVING frequency >= 2
      ORDER BY avg_response_time DESC, avg_feedback ASC
      LIMIT 50
    `;
    
    try {
      const [rows] = await pool.query(query);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error in getLowPerformanceAnswers:', error);
      return []; // 오류 시 빈 배열 반환
    }
  }

  // 답변 성능 메트릭 조회
  async getAnswerPerformanceMetrics(knowledgeId) {
    try {
      const query = `
        SELECT 
          kb.id,
          kb.question,
          kb.answer,
          COUNT(ca.id) as usage_count,
          AVG(ca.response_time_ms) as avg_response_time,
          AVG(CASE WHEN ca.user_feedback IS NOT NULL THEN ca.user_feedback ELSE 3 END) as avg_rating,
          SUM(CASE WHEN uf.feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
          SUM(CASE WHEN uf.feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful_count
        FROM knowledge_base kb
        LEFT JOIN chat_analytics ca ON kb.id = ca.matched_knowledge_id
        LEFT JOIN messages m ON ca.user_message = m.content
        LEFT JOIN user_feedback uf ON m.id = uf.message_id
        WHERE kb.id = ?
        GROUP BY kb.id, kb.question, kb.answer
      `;

      const [rows] = await pool.query(query, [knowledgeId]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting answer performance metrics:', error);
      return null;
    }
  }

  // 질문 클러스터 생성/업데이트
  async upsertQuestionCluster(clusterData) {
    try {
      const {
        cluster_name,
        representative_question,
        keywords,
        member_count,
        avg_confidence
      } = clusterData;

      const query = `
        INSERT INTO question_clusters 
        (cluster_name, representative_question, keywords, member_count, avg_confidence)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          member_count = member_count + VALUES(member_count),
          avg_confidence = (avg_confidence * member_count + VALUES(avg_confidence) * VALUES(member_count)) 
                          / (member_count + VALUES(member_count)),
          updated_at = CURRENT_TIMESTAMP
      `;

      const [result] = await pool.query(query, [
        cluster_name,
        representative_question,
        keywords,
        member_count,
        avg_confidence
      ]);

      return result.insertId || result.affectedRows;
    } catch (error) {
      console.error('Error upserting question cluster:', error);
      throw error;
    }
  }

  // 세션 분석 데이터
  async getSessionAnalytics(userId, sessionStart) {
    try {
      const query = `
        SELECT 
          COUNT(*) as message_count,
          AVG(response_time_ms) as avg_response_time,
          COUNT(DISTINCT chat_room_id) as rooms_used,
          SUM(CASE WHEN matched_knowledge_id IS NOT NULL THEN 1 ELSE 0 END) as db_answers,
          SUM(CASE WHEN matched_knowledge_id IS NULL THEN 1 ELSE 0 END) as ai_answers
        FROM chat_analytics ca
        JOIN messages m ON ca.user_message = m.content
        JOIN chat_rooms cr ON m.chat_room_id = cr.id
        WHERE cr.user_id = ? AND ca.created_at >= ?
      `;

      const [rows] = await pool.query(query, [userId, sessionStart]);
      return rows[0] || {
        message_count: 0,
        avg_response_time: 0,
        rooms_used: 0,
        db_answers: 0,
        ai_answers: 0
      };
    } catch (error) {
      console.error('Error getting session analytics:', error);
      return {
        message_count: 0,
        avg_response_time: 0,
        rooms_used: 0,
        db_answers: 0,
        ai_answers: 0
      };
    }
  }

  // 빈번한 질문 패턴 분석 - 추가된 메서드
  async getFrequentQuestionPatterns(minFrequency = 3) {
    try {
      const query = `
        SELECT 
          user_message,
          COUNT(*) as frequency,
          AVG(response_time_ms) as avg_response_time,
          AVG(CASE WHEN user_feedback IS NOT NULL THEN user_feedback ELSE 3 END) as avg_feedback,
          MIN(created_at) as first_occurrence,
          MAX(created_at) as last_occurrence
        FROM chat_analytics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY user_message
        HAVING frequency >= ?
        ORDER BY frequency DESC, avg_feedback DESC
        LIMIT 100
      `;

      const [rows] = await pool.query(query, [minFrequency]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting frequent question patterns:', error);
      return [];
    }
  }

  // 응답 품질 분석 - 추가된 메서드
  async getResponseQualityMetrics() {
    try {
      const query = `
        SELECT 
          response_source,
          COUNT(*) as total_responses,
          AVG(response_time_ms) as avg_response_time,
          AVG(CASE WHEN user_feedback IS NOT NULL THEN user_feedback ELSE 3 END) as avg_feedback,
          SUM(CASE WHEN response_time_ms < 1000 THEN 1 ELSE 0 END) as fast_responses,
          SUM(CASE WHEN user_feedback >= 4 THEN 1 ELSE 0 END) as positive_feedback
        FROM chat_analytics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY response_source
        ORDER BY avg_feedback DESC, avg_response_time ASC
      `;

      const [rows] = await pool.query(query);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting response quality metrics:', error);
      return [];
    }
  }

  // 사용자별 상호작용 패턴 분석 - 추가된 메서드
  async getUserInteractionPatterns(userId) {
    try {
      const query = `
        SELECT 
          DATE(ca.created_at) as interaction_date,
          COUNT(*) as message_count,
          AVG(ca.response_time_ms) as avg_response_time,
          AVG(CASE WHEN ca.user_feedback IS NOT NULL THEN ca.user_feedback ELSE 3 END) as avg_feedback,
          COUNT(DISTINCT m.chat_room_id) as rooms_used
        FROM chat_analytics ca
        JOIN messages m ON ca.user_message = m.content
        JOIN chat_rooms cr ON m.chat_room_id = cr.id
        WHERE cr.user_id = ? 
          AND ca.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(ca.created_at)
        ORDER BY interaction_date DESC
      `;

      const [rows] = await pool.query(query, [userId]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting user interaction patterns:', error);
      return [];
    }
  }

  // 학습 우선순위 업데이트 - 추가된 메서드
  async updateLearningPriority(id, newPriority) {
    try {
      const query = `
        UPDATE learning_queue 
        SET priority = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const [result] = await pool.query(query, [newPriority, id]);
      return result.affectedRows;
    } catch (error) {
      console.error('Error updating learning priority:', error);
      return 0;
    }
  }

  // 학습 큐 정리 (완료된 항목 삭제) - 추가된 메서드
  async cleanupLearningQueue(daysOld = 30) {
    try {
      const query = `
        DELETE FROM learning_queue 
        WHERE processing_status = 'completed' 
          AND processed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `;

      const [result] = await pool.query(query, [daysOld]);
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up learning queue:', error);
      return 0;
    }
  }

  // 학습 통계 조회 - 추가된 메서드
  async getLearningStats() {
    try {
      const query = `
        SELECT 
          processing_status,
          COUNT(*) as count,
          AVG(priority) as avg_priority
        FROM learning_queue
        GROUP BY processing_status
      `;

      const [rows] = await pool.query(query);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Error getting learning stats:', error);
      return [];
    }
  }
}

module.exports = new LearningDao();