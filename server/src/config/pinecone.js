const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const path = require('path');
require('cross-fetch/polyfill');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

class PineconeClient {
  constructor() {
    // 환경 변수 확인
    if (!process.env.PINECONE_API_KEY) {
      console.error('Environment variables:', {
        PINECONE_API_KEY: process.env.PINECONE_API_KEY ? 'Set' : 'Not set',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Set' : 'Not set',
        cwd: process.cwd(),
        nodeVersion: process.version
      });
      throw new Error('PINECONE_API_KEY is not set in environment variables');
    }
    
    console.log('Node.js version:', process.version);
    console.log('Fetch available:', typeof fetch !== 'undefined');
    
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.indexName = process.env.PINECONE_INDEX_NAME || 'seoultech-knowledge';
  }

  async initialize() {
    try {
      // 인덱스가 없으면 생성
      const indexes = await this.pinecone.listIndexes();
      const indexExists = indexes.indexes?.some(index => index.name === this.indexName);
      
      if (!indexExists) {
        await this.pinecone.createIndex({
          name: this.indexName,
          dimension: 1536, // OpenAI embeddings dimension
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: 'aws',
              region: 'us-east-1'
            }
          }
        });
        
        // 인덱스가 준비될 때까지 대기
        await this.waitForIndex();
      }
      
      this.index = this.pinecone.index(this.indexName);
      console.log('✅ Pinecone initialized successfully');
    } catch (error) {
      console.error('❌ Pinecone initialization error:', error);
      throw error;
    }
  }

  async waitForIndex() {
    let ready = false;
    while (!ready) {
      try {
        const description = await this.pinecone.describeIndex(this.indexName);
        ready = description.status?.ready;
        if (!ready) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // 텍스트를 임베딩으로 변환
  async createEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: text
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  // 벡터 업서트 (추가/업데이트)
  async upsertVectors(vectors) {
    try {
      const response = await this.index.upsert(vectors);
      return response;
    } catch (error) {
      console.error('Error upserting vectors:', error);
      throw error;
    }
  }

  // 유사도 검색
  async queryVectors(queryEmbedding, topK = 5, filter = {}) {
    try {
      // filter가 비어있으면 기본 필터 추가
      const queryFilter = Object.keys(filter).length > 0 ? filter : { 
        category: { "$exists": true } 
      };
      
      const queryResponse = await this.index.query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true,
        filter: queryFilter
      });
      return queryResponse.matches || [];
    } catch (error) {
      console.error('Error querying vectors:', error);
      throw error;
    }
  }

  // ID로 벡터 조회
  async fetchVectors(ids) {
    try {
      const response = await this.index.fetch(ids);
      return response.records;
    } catch (error) {
      console.error('Error fetching vectors:', error);
      throw error;
    }
  }

  // 벡터 삭제
  async deleteVectors(ids) {
    try {
      await this.index.deleteMany(ids);
      return true;
    } catch (error) {
      console.error('Error deleting vectors:', error);
      throw error;
    }
  }

  // 네임스페이스의 모든 벡터 삭제
  async deleteAllInNamespace(namespace) {
    try {
      await this.index.namespace(namespace).deleteAll();
      return true;
    } catch (error) {
      console.error('Error deleting namespace:', error);
      throw error;
    }
  }

  // 인덱스 통계 조회
  async getIndexStats() {
    try {
      const stats = await this.index.describeIndexStats();
      return stats;
    } catch (error) {
      console.error('Error getting index stats:', error);
      throw error;
    }
  }
}

// 싱글톤 인스턴스
let pineconeClient = null;

const getPineconeClient = async () => {
  if (!pineconeClient) {
    pineconeClient = new PineconeClient();
    await pineconeClient.initialize();
  }
  return pineconeClient;
};

module.exports = { getPineconeClient };