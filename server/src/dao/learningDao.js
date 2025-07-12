// server/src/dao/learningDao.js
const pool = require('../config/database');

class LearningDao {
  // 학습 큐에 항목 추가
  async addToLearningQueue(data) {
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
  }

  // 처리 대기 중인 학습 항목 가져오기
  async getPendingLearningItems(limit = 10) {
    const query = `
      SELECT * FROM learning_queue 
      WHERE processing_status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `;

    const [rows] = await pool.query(query, [limit]);
    return rows;
  }

  // 학습 항목 상태 업데이트
  async updateLearningStatus(id, status) {
    const query = `
      UPDATE learning_queue 
      SET processing_status = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const [result] = await pool.query(query, [status, id]);
    return result.affectedRows;
  }

  // 사용자 피드백 저장
  async saveUserFeedback(messageId, userId, feedbackType, feedbackText = null) {
    const query = `
      INSERT INTO user_feedback (message_id, user_id, feedback_type, feedback_text)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      messageId, userId, feedbackType, feedbackText
    ]);

    return result.insertId;
  }

  // 메시지에 대한 피드백 통계
  async getFeedbackStats(messageId) {
    const query = `
      SELECT 
        feedback_type,
        COUNT(*) as count
      FROM user_feedback
      WHERE message_id = ?
      GROUP BY feedback_type
    `;

    const [rows] = await pool.query(query, [messageId]);
    return rows;
  }

  // 최적화 기록 저장
  async saveOptimization(data) {
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
  }

  // 유사 질문 그룹핑을 위한 분석
  async getQuestionPatterns(timeframe = 7) {
    const query = `
      SELECT 
        user_message,
        bot_response,
        matched_knowledge_id,
        response_time_ms,
        COUNT(*) as frequency,
        AVG(CASE WHEN user_feedback IS NOT NULL THEN user_feedback ELSE 3 END) as avg_feedback
      FROM chat_analytics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY user_message, bot_response, matched_knowledge_id
      HAVING frequency > 1
      ORDER BY frequency DESC
      LIMIT 100
    `;

    const [rows] = await pool.query(query, [timeframe]);
    return rows;
  }

  // 답변 성능 메트릭 조회
  async getAnswerPerformanceMetrics(knowledgeId) {
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
    return rows[0];
  }

  // 질문 클러스터 생성/업데이트
  async upsertQuestionCluster(clusterData) {
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
  }

  // 세션 분석 데이터
  async getSessionAnalytics(userId, sessionStart) {
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
    return rows[0];
  }
}

module.exports = new LearningDao();