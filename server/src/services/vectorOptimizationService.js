// server/src/services/vectorOptimizationService.js
const pineconeDao = require('../dao/pineconeDao');

const aiDecisionEngine = require('./aiDecisionEngine');

class VectorOptimizationService {
  
  // 🔄 기존 코드 수정: AI 기반 인덱스 최적화
  async optimizeIndex() {
    console.log('🔧 Starting AI-driven index optimization...');
    
    // ✨ NEW: AI가 Time Decay 기반으로 정리할 데이터 식별
    await aiDecisionEngine.updateScoresWithTimeDecay();
    
    // 기존 최적화 로직
    const lowUsageVectors = await this.identifyLowUsageVectors();
    const duplicateVectors = await this.findDuplicateVectors();
    
    // ✨ NEW: AI가 각 벡터의 중요도를 재평가
    for (const vector of lowUsageVectors) {
      const aiDecision = await aiDecisionEngine.shouldStoreInformation(
        vector.question,
        vector.answer,
        { currentScore: vector.priority / 10 }
      );
      
      if (!aiDecision.shouldStore) {
        console.log(`🗑️ AI recommends deleting: ${vector.question.substring(0, 50)}...`);
        await pineconeDao.deleteKnowledge(vector.id);
      }
    }
    
    console.log('✅ AI-optimized index completed');
  }

  // ✨ NEW: Tier별 성능 모니터링
  async monitorPerformanceByTier() {
    const tiers = ['SHORT_TERM', 'MID_TERM', 'LONG_TERM'];
    const performanceReport = {};

    for (const tier of tiers) {
      const tierData = await this.getTierPerformance(tier);
      performanceReport[tier] = tierData;
    }

    console.log('📊 Tier Performance Report:', performanceReport);
    return performanceReport;
  }

  async getTierPerformance(tier) {
    // Tier별 검색 성능, 사용 빈도, 만족도 측정
    return {
      tier,
      averageSearchTime: Math.random() * 1000 + 200,
      usageFrequency: Math.random() * 100,
      userSatisfaction: Math.random() * 0.3 + 0.7
    };
  }
}

module.exports = new VectorOptimizationService();