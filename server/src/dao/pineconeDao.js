const { getPineconeClient } = require('../config/pinecone');
const { v4: uuidv4 } = require('uuid');

class PineconeDao {
  constructor() {
    this.client = null;
  }

  async initialize() {
    if (!this.client) {
      this.client = await getPineconeClient();
    }
  }

  // 지식 항목 추가
  async addKnowledge(knowledgeData) {
    await this.initialize();
    
    try {
      const {
        question,
        answer,
        keywords,
        category,
        priority = 0,
        metadata = {}
      } = knowledgeData;

      // 검색을 위한 통합 텍스트 생성
      const searchText = `${question} ${keywords} ${answer}`;
      
      // 임베딩 생성
      const embedding = await this.client.createEmbedding(searchText);
      
      // 고유 ID 생성
      const id = uuidv4();
      
      // 벡터 데이터 구성
      const vector = {
        id,
        values: embedding,
        metadata: {
          question,
          answer,
          keywords,
          category,
          priority,
          searchText: searchText.substring(0, 1000), // 메타데이터 크기 제한
          createdAt: new Date().toISOString(),
          ...metadata
        }
      };
      
      // Pinecone에 저장
      await this.client.upsertVectors([vector]);
      
      console.log(`✅ Knowledge added to Pinecone: ${id}`);
      return id;
    } catch (error) {
      console.error('Error adding knowledge to Pinecone:', error);
      throw error;
    }
  }

  // 여러 지식 항목 일괄 추가
  async addKnowledgeBatch(knowledgeItems) {
    await this.initialize();
    
    try {
      const vectors = [];
      
      for (const item of knowledgeItems) {
        const searchText = `${item.question} ${item.keywords} ${item.answer}`;
        const embedding = await this.client.createEmbedding(searchText);
        const id = item.id || uuidv4();
        
        vectors.push({
          id,
          values: embedding,
          metadata: {
            question: item.question,
            answer: item.answer,
            keywords: item.keywords,
            category: item.category || 'general',
            priority: item.priority || 0,
            searchText: searchText.substring(0, 1000),
            createdAt: new Date().toISOString()
          }
        });
      }
      
      // 배치로 업서트 (100개씩 나눠서 처리)
      const batchSize = 100;
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        await this.client.upsertVectors(batch);
      }
      
      console.log(`✅ ${vectors.length} knowledge items added to Pinecone`);
      return vectors.map(v => v.id);
    } catch (error) {
      console.error('Error adding knowledge batch to Pinecone:', error);
      throw error;
    }
  }

  // 질문에 대한 답변 검색
  async searchAnswer(userMessage, topK = 5) {
    await this.initialize();
    
    try {
      console.log('🔍 Searching in Pinecone for:', userMessage);
      
      // 사용자 메시지를 임베딩으로 변환
      const queryEmbedding = await this.client.createEmbedding(userMessage);
      
      // 유사도 검색 수행
      // 모든 벡터를 검색하기 위한 '항상 true인' 필터를 적용합니다.
      // 'question' 필드는 모든 지식 항목에 존재하므로 이를 사용합니다.
      const filter = {
        question: { "$exists": true } // 모든 벡터에 'question' 메타데이터 필드가 존재함을 확인
      };

      const results = await this.client.queryVectors(queryEmbedding, topK, filter); // <--- 수정된 filter 전달
      
      if (results.length === 0) {
        console.log('No matches found in Pinecone');
        return null;
      }
      
      // 점수 임계값 설정 (0.7 이상만 반환)
      const relevantResults = results.filter(match => match.score >= 0.7);
      
      if (relevantResults.length === 0) {
        console.log('No relevant matches found (score < 0.7)');
        return null;
      }
      
      // 가장 높은 점수의 결과 반환
      const bestMatch = relevantResults[0];
      console.log(`✅ Best match found: ${bestMatch.id} (score: ${bestMatch.score})`);
      
      return {
        id: bestMatch.id,
        ...bestMatch.metadata,
        score: bestMatch.score
      };
    } catch (error) {
      console.error('Error searching in Pinecone:', error);
      throw error;
    }
  }

  // 카테고리별 검색
  async searchByCategory(userMessage, category, topK = 5) {
    await this.initialize();
    
    try {
      const queryEmbedding = await this.client.createEmbedding(userMessage);
      
      // 카테고리 필터 적용
      const filter = {
        category: { $eq: category }
      };
      
      const results = await this.client.queryVectors(queryEmbedding, topK, filter);
      
      return results.map(match => ({
        id: match.id,
        ...match.metadata,
        score: match.score
      }));
    } catch (error) {
      console.error('Error searching by category in Pinecone:', error);
      throw error;
    }
  }

  // ID로 지식 항목 조회
  async getKnowledgeById(id) {
    await this.initialize();
    
    try {
      const results = await this.client.fetchVectors([id]);
      
      if (!results || !results[id]) {
        return null;
      }
      
      return {
        id,
        ...results[id].metadata
      };
    } catch (error) {
      console.error('Error fetching knowledge by ID:', error);
      throw error;
    }
  }

  // 지식 항목 업데이트
  async updateKnowledge(id, updateData) {
    await this.initialize();
    
    try {
      // 기존 데이터 조회
      const existing = await this.getKnowledgeById(id);
      if (!existing) {
        throw new Error('Knowledge item not found');
      }
      
      // 업데이트된 데이터 병합
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      
      // 새로운 검색 텍스트 생성
      const searchText = `${updated.question} ${updated.keywords} ${updated.answer}`;
      
      // 새로운 임베딩 생성
      const embedding = await this.client.createEmbedding(searchText);
      
      // 벡터 업데이트
      const vector = {
        id,
        values: embedding,
        metadata: {
          ...updated,
          searchText: searchText.substring(0, 1000)
        }
      };
      
      await this.client.upsertVectors([vector]);
      
      console.log(`✅ Knowledge updated in Pinecone: ${id}`);
      return id;
    } catch (error) {
      console.error('Error updating knowledge in Pinecone:', error);
      throw error;
    }
  }

  // 지식 항목 삭제
  async deleteKnowledge(ids) {
    await this.initialize();
    
    try {
      const idsArray = Array.isArray(ids) ? ids : [ids];
      await this.client.deleteVectors(idsArray);
      
      console.log(`✅ ${idsArray.length} knowledge items deleted from Pinecone`);
      return true;
    } catch (error) {
      console.error('Error deleting knowledge from Pinecone:', error);
      throw error;
    }
  }

  // 인덱스 통계 조회
  async getStats() {
    await this.initialize();
    
    try {
      const stats = await this.client.getIndexStats();
      return stats;
    } catch (error) {
      console.error('Error getting Pinecone stats:', error);
      throw error;
    }
  }

  // 모든 지식 항목 조회 (페이지네이션)
  async getAllKnowledge(namespace = '', limit = 100) {
    await this.initialize();
    
    try {
      // Pinecone은 직접적인 "모든 벡터 조회" API를 제공하지 않음
      // 대신 높은 차원의 랜덤 벡터로 쿼리하여 모든 결과를 가져옴
      const randomVector = Array(1536).fill(0).map(() => Math.random());
      
      const results = await this.client.queryVectors(randomVector, limit);
      
      return results.map(match => ({
        id: match.id,
        ...match.metadata,
        score: match.score
      }));
    } catch (error) {
      console.error('Error getting all knowledge from Pinecone:', error);
      throw error;
    }
  }
}

module.exports = new PineconeDao();