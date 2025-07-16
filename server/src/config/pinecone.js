const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const path = require('path');
require('cross-fetch/polyfill');

// 환경 변수 로딩 - 여러 경로 시도
const envPaths = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env')
];

let envLoaded = false;
for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    console.log(`Environment loaded from: ${envPath}`);
    envLoaded = true;
    break;
  } catch (error) {
    console.warn(`Failed to load env from ${envPath}`);
  }
}

if (!envLoaded) {
  console.warn('No .env file found, using system environment variables');
}

class PineconeClient {
  constructor() {
    // 모든 필수 환경 변수 확인
    const requiredEnvVars = {
      PINECONE_API_KEY: process.env.PINECONE_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY
    };

    const missingVars = Object.entries(requiredEnvVars)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      console.error('Missing environment variables:', missingVars);
      console.error('Current environment status:', {
        PINECONE_API_KEY: process.env.PINECONE_API_KEY ? `Set (${process.env.PINECONE_API_KEY.substring(0, 8)}...)` : 'Not set',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `Set (${process.env.OPENAI_API_KEY.substring(0, 8)}...)` : 'Not set',
        cwd: process.cwd(),
        nodeVersion: process.version
      });
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    console.log('Node.js version:', process.version);
    console.log('Fetch available:', typeof fetch !== 'undefined');
    
    // Pinecone 클라이언트 초기화
    try {
      this.pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY
      });
      console.log('✅ Pinecone client created');
    } catch (error) {
      console.error('❌ Failed to create Pinecone client:', error);
      throw error;
    }
    
    // OpenAI 클라이언트 초기화
    try {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      console.log('✅ OpenAI client created');
    } catch (error) {
      console.error('❌ Failed to create OpenAI client:', error);
      throw error;
    }
    
    this.indexName = process.env.PINECONE_INDEX_NAME || 'seoultech-knowledge';
  }

  async initialize() {
    try {
      // OpenAI API 키 테스트
      await this.testOpenAIConnection();
      
      // 인덱스가 없으면 생성
      const indexes = await this.pinecone.listIndexes();
      const indexExists = indexes.indexes?.some(index => index.name === this.indexName);
      
      if (!indexExists) {
        console.log(`Creating index: ${this.indexName}`);
        await this.pinecone.createIndex({
          name: this.indexName,
          dimension: 1536, // text-embedding-3-small dimension
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

  async testOpenAIConnection() {
    try {
      console.log('Testing OpenAI API connection...');
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: "test connection"
      });
      console.log('✅ OpenAI API connection successful');
      return true;
    } catch (error) {
      console.error('❌ OpenAI API connection failed:', error.message);
      
      // 더 자세한 에러 정보 제공
      if (error.status === 401) {
        console.error('Authentication failed. Please check your OPENAI_API_KEY');
        console.error('Current API key format:', process.env.OPENAI_API_KEY ? 
          `${process.env.OPENAI_API_KEY.substring(0, 8)}...` : 'undefined');
      } else if (error.status === 429) {
        console.error('Rate limit exceeded or insufficient quota');
      }
      
      throw error;
    }
  }

  async waitForIndex() {
    console.log('Waiting for index to be ready...');
    let ready = false;
    let attempts = 0;
    const maxAttempts = 60; // 5분 최대 대기
    
    while (!ready && attempts < maxAttempts) {
      try {
        const description = await this.pinecone.describeIndex(this.indexName);
        ready = description.status?.ready;
        if (!ready) {
          console.log(`Index not ready yet, waiting... (${attempts + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.warn('Error checking index status:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      attempts++;
    }
    
    if (!ready) {
      throw new Error('Index creation timeout - index not ready after 5 minutes');
    }
    
    console.log('✅ Index is ready');
  }

  // 텍스트를 임베딩으로 변환 (최신 모델 사용)
  async createEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small", // 최신 모델 사용
        input: text
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error creating embedding:', error.message);
      
      // 에러 타입별 처리
      if (error.status === 401) {
        console.error('OpenAI API authentication failed. Check your API key.');
      } else if (error.status === 429) {
        console.error('OpenAI API rate limit exceeded.');
      } else if (error.status === 400) {
        console.error('Invalid request to OpenAI API:', error.message);
      }
      
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