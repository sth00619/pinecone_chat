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

  // Missing Implementation 1: Pinecone ID로 기존 지식 찾기
  async findByPineconeId(pineconeId) {
    try {
      const query = `
        SELECT kb.*, kps.pinecone_id, kps.performance_score, kps.usage_count
        FROM knowledge_base kb
        LEFT JOIN knowledge_pinecone_sync kps ON kb.id = kps.knowledge_base_id
        WHERE kps.pinecone_id = ?
        LIMIT 1
      `;
      
      const [rows] = await pool.query(query, [pineconeId]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error finding by Pinecone ID:', error);
      throw error;
    }
  }

  // Missing Implementation 1: Pinecone에서 RDBMS로 지식 생성
  async createFromPinecone(data) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 1. knowledge_base에 추가
      const insertKnowledgeQuery = `
        INSERT INTO knowledge_base 
        (category_id, question, answer, keywords, priority, is_active, created_at) 
        VALUES (?, ?, ?, ?, ?, TRUE, NOW())
      `;
      
      // 카테고리 ID 찾기 또는 기본값 사용
      const categoryId = await this.getCategoryIdByName(data.category) || 1;
      
      const [knowledgeResult] = await connection.query(insertKnowledgeQuery, [
        categoryId,
        data.question,
        data.answer,
        data.keywords,
        data.priority || 5
      ]);
      
      const knowledgeBaseId = knowledgeResult.insertId;
      
      // 2. knowledge_pinecone_sync에 매핑 추가
      const insertSyncQuery = `
        INSERT INTO knowledge_pinecone_sync 
        (knowledge_base_id, pinecone_id, sync_direction, performance_score, usage_count) 
        VALUES (?, ?, 'from_pinecone', ?, ?)
      `;
      
      await connection.query(insertSyncQuery, [
        knowledgeBaseId,
        data.pinecone_id,
        data.performance_score || 0,
        data.usage_count || 0
      ]);
      
      await connection.commit();
      return knowledgeBaseId;
    } catch (error) {
      await connection.rollback();
      console.error('Error creating from Pinecone:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Missing Implementation 4: Pinecone 성능 데이터로 RDBMS 업데이트
  async upsertFromPinecone(data) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 기존 매핑 확인
      const existingSync = await this.findByPineconeId(data.pinecone_id);
      
      if (existingSync) {
        // 기존 데이터 업데이트
        const updateKnowledgeQuery = `
          UPDATE knowledge_base 
          SET answer = ?, priority = ?, updated_at = NOW()
          WHERE id = ?
        `;
        
        await connection.query(updateKnowledgeQuery, [
          data.answer,
          Math.min(10, (existingSync.priority || 5) + 1), // 성능 좋으면 우선순위 증가
          existingSync.id
        ]);
        
        // 동기화 정보 업데이트
        const updateSyncQuery = `
          UPDATE knowledge_pinecone_sync 
          SET performance_score = ?, usage_count = ?, last_synced = NOW()
          WHERE pinecone_id = ?
        `;
        
        await connection.query(updateSyncQuery, [
          data.performance_score,
          data.usage_count,
          data.pinecone_id
        ]);
      } else {
        // 새로 생성
        await this.createFromPinecone(data);
      }
      
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error('Error upserting from Pinecone:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Missing Implementation 4: Pinecone 사용 통계 조회
  async getPineconeUsageStats() {
    try {
      const query = `
        SELECT 
          kps.pinecone_id,
          kb.question,
          kb.answer,
          COUNT(ca.id) as usage_count,
          MAX(ca.created_at) as last_used
        FROM knowledge_pinecone_sync kps
        JOIN knowledge_base kb ON kps.knowledge_base_id = kb.id
        LEFT JOIN chat_analytics ca ON kb.id = ca.matched_knowledge_id
        WHERE ca.response_source = 'pinecone'
        GROUP BY kps.pinecone_id, kb.question, kb.answer
        HAVING usage_count > 0
        ORDER BY usage_count DESC
      `;
      
      const [rows] = await pool.query(query);
      return rows;
    } catch (error) {
      console.error('Error getting Pinecone usage stats:', error);
      throw error;
    }
  }

  // 카테고리 이름으로 ID 찾기
  async getCategoryIdByName(categoryName) {
    try {
      const query = 'SELECT id FROM knowledge_categories WHERE name = ? LIMIT 1';
      const [rows] = await pool.query(query, [categoryName]);
      return rows[0]?.id || null;
    } catch (error) {
      console.error('Error getting category ID by name:', error);
      return null;
    }
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