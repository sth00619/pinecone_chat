const pool = require('../config/database');

class KnowledgeDao {
  // 메시지 정규화 헬퍼 메서드
  normalizeMessage(message) {
    // 특수문자 제거, 공백 정리, 소문자 변환
    return message
      .toLowerCase()
      .replace(/[^가-힣a-z0-9\s]/g, ' ')  // 특수문자를 공백으로
      .replace(/\s+/g, ' ')               // 연속 공백을 하나로
      .trim();
  }

  // searchByKeywords 메서드 - 간소화된 버전
  async searchByKeywords(userMessage) {
    try {
      // 사용자 메시지를 소문자로 변환
      const lowerMessage = userMessage.toLowerCase();
      
      // 더 간단한 쿼리로 시작
      const query = `
        SELECT 
          kb.id, 
          kb.category_id, 
          kb.question, 
          kb.answer, 
          kb.priority, 
          kb.is_active,
          kb.created_at, 
          kb.updated_at, 
          kc.name as category_name,
          kb.keywords
        FROM knowledge_base kb
        JOIN knowledge_categories kc ON kb.category_id = kc.id
        WHERE kb.is_active = TRUE 
          AND kc.is_active = TRUE
          AND (
            LOWER(kb.keywords) LIKE CONCAT('%', ?, '%')
            OR LOWER(kb.question) LIKE CONCAT('%', ?, '%')
          )
        ORDER BY kb.priority DESC
        LIMIT 5
      `;
      
      const [results] = await pool.query(query, [lowerMessage, lowerMessage]);
      
      // 결과가 있으면 더 정교한 점수 계산
      if (results.length > 0) {
        // 각 결과에 대해 점수 계산
        const scoredResults = results.map(result => {
          let score = result.priority || 0;
          
          // keywords가 있는 경우 키워드 매칭 점수 계산
          if (result.keywords) {
            const keywords = result.keywords.split(',').map(k => k.trim().toLowerCase());
            keywords.forEach(keyword => {
              if (lowerMessage.includes(keyword)) {
                score += 10;
              }
            });
          }
          
          // 질문이 정확히 일치하면 높은 점수
          if (result.question.toLowerCase() === lowerMessage) {
            score += 50;
          }
          
          return { ...result, score };
        });
        
        // 점수순으로 정렬
        scoredResults.sort((a, b) => b.score - a.score);
        
        console.log(`Keyword search for "${userMessage}":`, scoredResults.length > 0 ? `Found ${scoredResults.length} matches` : 'No matches');
        
        return scoredResults;
      }
      
      return [];
    } catch (error) {
      console.error('Error in searchByKeywords:', error);
      throw error;
    }
  }

  // 카테고리별 지식베이스 조회
  async getByCategory(categoryId) {
    const query = `
      SELECT kb.*, kc.name as category_name
      FROM knowledge_base kb
      JOIN knowledge_categories kc ON kb.category_id = kc.id
      WHERE kb.category_id = ? 
        AND kb.is_active = TRUE
        AND kc.is_active = TRUE
      ORDER BY kb.priority DESC
    `;
    
    const [rows] = await pool.query(query, [categoryId]);
    return rows;
  }

  // 모든 카테고리 조회
  async getAllCategories() {
    const [rows] = await pool.query(
      'SELECT * FROM knowledge_categories WHERE is_active = TRUE ORDER BY id'
    );
    return rows;
  }

  // 채팅 분석 로그 저장
  async logChatAnalytics(userMessage, botResponse, matchedKnowledgeId = null, responseTimeMs = 0) {
    const query = `
      INSERT INTO chat_analytics 
      (user_message, bot_response, matched_knowledge_id, response_time_ms) 
      VALUES (?, ?, ?, ?)
    `;
    
    const [result] = await pool.query(query, [
      userMessage, 
      botResponse, 
      matchedKnowledgeId, 
      responseTimeMs
    ]);
    
    return result.insertId;
  }

  // 단어별 매칭 검색 (간소화된 버전)
  async searchByWords(userMessage) {
    try {
      // 메시지 정규화
      const normalizedMessage = this.normalizeMessage(userMessage);
      const words = normalizedMessage.split(' ').filter(word => word.length > 1);
      
      if (words.length === 0) return [];
      
      // 각 단어에 대한 OR 조건 생성
      const conditions = [];
      const params = [];
      
      words.forEach(word => {
        conditions.push('LOWER(kb.keywords) LIKE ?');
        conditions.push('LOWER(kb.question) LIKE ?');
        params.push(`%${word}%`);
        params.push(`%${word}%`);
      });
      
      const query = `
        SELECT 
          kb.id,
          kb.category_id,
          kb.question,
          kb.answer,
          kb.priority,
          kb.is_active,
          kb.created_at,
          kb.updated_at,
          kc.name as category_name,
          kb.keywords
        FROM knowledge_base kb
        JOIN knowledge_categories kc ON kb.category_id = kc.id
        WHERE kb.is_active = TRUE 
          AND kc.is_active = TRUE
          AND (${conditions.join(' OR ')})
        ORDER BY kb.priority DESC
        LIMIT 5
      `;
      
      const [rows] = await pool.query(query, params);
      
      // 점수 계산
      const scoredResults = rows.map(row => {
        let score = row.priority || 0;
        
        // 각 단어가 매칭되면 점수 추가
        words.forEach(word => {
          if (row.keywords && row.keywords.toLowerCase().includes(word)) {
            score += 5;
          }
          if (row.question && row.question.toLowerCase().includes(word)) {
            score += 3;
          }
        });
        
        return { ...row, score };
      });
      
      // 점수순 정렬
      scoredResults.sort((a, b) => b.score - a.score);
      
      console.log(`Word search for "${userMessage}":`, scoredResults.length > 0 ? `Found ${scoredResults.length} matches` : 'No matches');
      
      return scoredResults;
    } catch (error) {
      console.error('Error in word-based search:', error);
      throw error;
    }
  }

  // 특정 질문에 대한 정확한 답변 조회
  async getExactAnswer(question) {
    const query = `
      SELECT kb.*, kc.name as category_name
      FROM knowledge_base kb
      JOIN knowledge_categories kc ON kb.category_id = kc.id
      WHERE kb.is_active = TRUE 
        AND kc.is_active = TRUE
        AND LOWER(kb.question) = LOWER(?)
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query, [question]);
    return rows[0];
  }

  // 유사도 기반 검색 (간소화된 버전)
  async searchBySimilarity(userMessage) {
    try {
      const normalizedMessage = this.normalizeMessage(userMessage);
      
      // 핵심 키워드 추출 (2글자 이상)
      const keywords = normalizedMessage.split(' ')
        .filter(word => word.length >= 2)
        .slice(0, 5); // 최대 5개 키워드만 사용
      
      if (keywords.length === 0) return [];
      
      // 간단한 매칭 쿼리
      const conditions = keywords.map(() => 'LOWER(kb.keywords) LIKE ?').join(' OR ');
      const params = keywords.map(keyword => `%${keyword}%`);
      
      const query = `
        SELECT 
          kb.id,
          kb.category_id,
          kb.question,
          kb.answer,
          kb.priority,
          kb.is_active,
          kb.created_at,
          kb.updated_at,
          kc.name as category_name,
          kb.keywords
        FROM knowledge_base kb
        JOIN knowledge_categories kc ON kb.category_id = kc.id
        WHERE kb.is_active = TRUE 
          AND kc.is_active = TRUE
          AND (${conditions})
        ORDER BY kb.priority DESC
        LIMIT 3
      `;
      
      const [rows] = await pool.query(query, params);
      return rows;
    } catch (error) {
      console.error('Error in similarity search:', error);
      return [];
    }
  }

  // 통합 검색 메서드 (모든 검색 방법을 순차적으로 시도)
  async searchAnswer(userMessage) {
    try {
      console.log('Searching for:', userMessage);
      
      // 1. 먼저 정확한 질문 매칭 시도
      const exactMatch = await this.getExactAnswer(userMessage);
      if (exactMatch) {
        console.log('Exact match found:', exactMatch.id);
        return exactMatch;
      }
      
      // 2. 키워드 기반 검색 (개선된 버전)
      const keywordResults = await this.searchByKeywords(userMessage);
      if (keywordResults.length > 0) {
        console.log('Keyword match found:', keywordResults[0].id);
        return keywordResults[0];
      }
      
      // 3. 단어별 매칭 검색 (개선된 버전)
      const wordResults = await this.searchByWords(userMessage);
      if (wordResults.length > 0) {
        console.log('Word match found:', wordResults[0].id);
        return wordResults[0];
      }
      
      // 4. 유사도 기반 검색
      const similarResults = await this.searchBySimilarity(userMessage);
      if (similarResults.length > 0) {
        console.log('Similar match found:', similarResults[0].id);
        return similarResults[0];
      }
      
      console.log('No match found');
      return null;
    } catch (error) {
      console.error('Error in searchAnswer:', error);
      throw error;
    }
  }
}

module.exports = new KnowledgeDao();