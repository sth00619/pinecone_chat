// server/src/modules/learningEngine.js
const knowledgeDao = require('../dao/knowledgeDao');
const pineconeDao = require('../dao/pineconeDao');
const learningDao = require('../dao/learningDao');
const personalDataDao = require('../dao/personalDataDao');

class LearningEngine {
  constructor() {
    this.isProcessing = false;
    this.processInterval = null;
  }

  // 학습 엔진 시작
  start() {
    console.log('🧠 Learning Engine started');
    
    // 5분마다 학습 큐 처리
    this.processInterval = setInterval(() => {
      this.processLearningQueue();
    }, 5 * 60 * 1000);
    
    // 즉시 한 번 실행
    this.processLearningQueue();
  }

  // 학습 엔진 중지
  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    console.log('🛑 Learning Engine stopped');
  }

  // 학습 큐 처리
  async processLearningQueue() {
    if (this.isProcessing) {
      console.log('⏳ Learning queue is already being processed');
      return;
    }

    this.isProcessing = true;

    try {
      console.log('🔄 Processing learning queue...');
      
      // 1. 대기 중인 학습 항목 가져오기
      const pendingItems = await learningDao.getPendingLearningItems(20);
      
      if (pendingItems.length === 0) {
        console.log('✅ No pending items in learning queue');
        return;
      }

      console.log(`📚 Processing ${pendingItems.length} learning items`);

      for (const item of pendingItems) {
        try {
          await this.processLearningItem(item);
          
          // 처리 완료 표시
          await learningDao.updateLearningStatus(item.id, 'completed');
        } catch (error) {
          console.error(`Error processing learning item ${item.id}:`, error);
          await learningDao.updateLearningStatus(item.id, 'failed');
        }
      }

      // 2. Pinecone 성능 분석 및 RDBMS 업데이트
      await this.updateRDBMSFromPineconePerformance();

      // 3. 질문 패턴 분석
      await this.analyzeQuestionPatterns();

    } catch (error) {
      console.error('Error in processLearningQueue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // 개별 학습 항목 처리
  async processLearningItem(item) {
    // 개인정보 포함 여부 확인
    const personalDataInQuestion = await personalDataDao.detectPersonalDataType(item.user_message);
    const personalDataInAnswer = await personalDataDao.detectPersonalDataType(item.bot_response);

    if (personalDataInQuestion.length > 0 || personalDataInAnswer.length > 0) {
      console.log(`⚠️ Personal data detected in learning item ${item.id}, skipping`);
      return;
    }

    // 응답 소스별 처리
    switch (item.response_source) {
      case 'chatgpt':
        await this.processChatGPTResponse(item);
        break;
      case 'localdb':
        await this.processLocalDBResponse(item);
        break;
      case 'pinecone':
        await this.processPineconeResponse(item);
        break;
      case 'session_analysis':
        await this.processSessionAnalysis(item);
        break;
    }
  }

  // ChatGPT 응답 처리
  async processChatGPTResponse(item) {
    // ChatGPT 응답이 좋은 경우 Pinecone에 저장
    if (item.confidence_score >= 0.7) {
      try {
        await pineconeDao.addKnowledge({
          question: item.user_message,
          answer: item.bot_response,
          keywords: this.extractKeywords(item.user_message),
          category: 'chatgpt-learned',
          priority: Math.round(item.confidence_score * 10),
          metadata: {
            source: 'learning_engine',
            learned_at: new Date().toISOString()
          }
        });
        console.log('💾 Good ChatGPT response saved to Pinecone');
      } catch (error) {
        console.error('Error saving to Pinecone:', error);
      }
    }
  }

  // 로컬 DB 응답 처리
  async processLocalDBResponse(item) {
    if (item.matched_knowledge_id) {
      // 답변 성능 메트릭 조회
      const metrics = await learningDao.getAnswerPerformanceMetrics(item.matched_knowledge_id);
      
      // 성능이 낮은 경우 최적화 필요
      if (metrics.avg_rating < 3.0 || metrics.not_helpful_count > metrics.helpful_count) {
        console.log(`📉 Low performing answer detected (ID: ${item.matched_knowledge_id})`);
        // TODO: 답변 최적화 로직 구현
      }
    }
  }

  // Pinecone 응답 처리
  async processPineconeResponse(item) {
    // Pinecone 응답의 성능이 좋은 경우 로컬 DB에도 저장
    if (item.confidence_score >= 0.85) {
      try {
        // 이미 로컬 DB에 있는지 확인
        const existing = await knowledgeDao.findByPineconeId(item.matched_knowledge_id);
        
        if (!existing) {
          await knowledgeDao.createFromPinecone({
            pinecone_id: item.matched_knowledge_id,
            question: item.user_message,
            answer: item.bot_response,
            keywords: this.extractKeywords(item.user_message),
            category: 'pinecone-synced',
            priority: 8,
            performance_score: item.confidence_score,
            usage_count: 1
          });
          console.log('✅ High-quality Pinecone answer synced to local DB');
        }
      } catch (error) {
        console.error('Error syncing to local DB:', error);
      }
    }
  }

  // 세션 분석 항목 처리
  async processSessionAnalysis(item) {
    // 세션에서 학습된 대화 패턴을 분석하여 저장
    console.log('📊 Processing session analysis item');
    
    // 유사한 질문들을 클러스터링
    await learningDao.upsertQuestionCluster({
      cluster_name: this.generateClusterName(item.user_message),
      representative_question: item.user_message,
      keywords: this.extractKeywords(item.user_message),
      member_count: 1,
      avg_confidence: item.confidence_score
    });
  }

  // Missing Implementation 4: Pinecone 성능 분석
  async analyzePineconePerformance() {
    try {
      // Pinecone 사용 통계 가져오기
      const usageStats = await knowledgeDao.getPineconeUsageStats();
      
      // 성능 데이터 분석
      const performanceData = usageStats.map(stat => {
        // 간단한 점수 계산 (실제로는 더 복잡한 알고리즘 필요)
        const recencyScore = this.calculateRecencyScore(stat.last_used);
        const usageScore = Math.min(stat.usage_count / 100, 1);
        const userFeedbackScore = 4.5; // TODO: 실제 피드백 데이터 연동
        
        return {
          id: stat.pinecone_id,
          question: stat.question,
          answer: stat.answer,
          usageCount: stat.usage_count,
          userFeedbackScore: userFeedbackScore,
          overallScore: (recencyScore + usageScore + userFeedbackScore) / 3
        };
      });
      
      return performanceData;
    } catch (error) {
      console.error('Error analyzing Pinecone performance:', error);
      return [];
    }
  }

  // Missing Implementation 4: RDBMS 업데이트
  async updateRDBMSFromPineconePerformance() {
    try {
      // Get performance metrics from Pinecone
      const performanceData = await this.analyzePineconePerformance();
      
      for (const item of performanceData) {
        if (item.userFeedbackScore > 4.0 && item.usageCount > 10) {
          // Update RDBMS with high-performing Pinecone answers
          await knowledgeDao.upsertFromPinecone({
            pinecone_id: item.id,
            question: item.question,
            answer: item.answer,
            performance_score: item.userFeedbackScore,
            usage_count: item.usageCount,
            last_updated: new Date()
          });
          
          console.log(`📈 High-performing Pinecone answer synced to RDBMS (ID: ${item.id})`);
        }
      }
    } catch (error) {
      console.error('Error updating RDBMS from Pinecone performance:', error);
    }
  }

  // 질문 패턴 분석
  async analyzeQuestionPatterns() {
    try {
      const patterns = await learningDao.getQuestionPatterns(7);
      
      for (const pattern of patterns) {
        if (pattern.frequency > 5 && pattern.avg_feedback < 3) {
          console.log(`🔍 Frequently asked question with low satisfaction: "${pattern.user_message}"`);
          
          // 자주 묻는 질문인데 만족도가 낮은 경우 개선 필요
          await learningDao.saveOptimization({
            original_question: pattern.user_message,
            original_answer: pattern.bot_response,
            optimized_answer: null, // TODO: GPT로 개선된 답변 생성
            optimization_reason: 'Low satisfaction score for frequently asked question',
            improvement_score: 0
          });
        }
      }
    } catch (error) {
      console.error('Error analyzing question patterns:', error);
    }
  }

  // 유틸리티 메서드들
  extractKeywords(text) {
    // 간단한 키워드 추출 (실제로는 더 정교한 NLP 필요)
    const stopWords = ['은', '는', '이', '가', '을', '를', '에', '에서', '으로', '와', '과', '의', '에게'];
    const words = text.split(/\s+/)
      .filter(word => word.length > 1)
      .filter(word => !stopWords.includes(word))
      .map(word => word.replace(/[^가-힣a-zA-Z0-9]/g, ''))
      .filter(word => word.length > 0);
    
    // 중복 제거하고 최대 5개 키워드 반환
    return [...new Set(words)].slice(0, 5).join(', ');
  }

  generateClusterName(question) {
    // 질문을 기반으로 클러스터 이름 생성
    const keywords = this.extractKeywords(question).split(', ');
    return keywords.slice(0, 2).join('_') || 'general';
  }

  calculateRecencyScore(lastUsed) {
    if (!lastUsed) return 0;
    
    const now = new Date();
    const last = new Date(lastUsed);
    const daysDiff = (now - last) / (1000 * 60 * 60 * 24);
    
    // 최근일수록 높은 점수
    if (daysDiff < 1) return 1;
    if (daysDiff < 7) return 0.8;
    if (daysDiff < 30) return 0.6;
    return 0.4;
  }
}

module.exports = new LearningEngine();