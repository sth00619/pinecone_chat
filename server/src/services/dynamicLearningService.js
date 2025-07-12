// server/src/services/dynamicLearningService.js
// server/src/services/enhancedDynamicLearningService.js
const aiDecisionEngine = require('./aiDecisionEngine');
const pineconeDao = require('../dao/pineconeDao');

class DynamicLearningService {
  
  // 🔄 기존 코드 수정: AI가 저장 여부를 결정하도록 변경
  async addToLearningQueue(question, answer, quality) {
    console.log('🤖 AI evaluating whether to store this knowledge...');
    
    // ✨ NEW: AI가 저장 여부 결정 (당신이 원했던 기능!)
    const aiDecision = await aiDecisionEngine.shouldStoreInformation(
      question, 
      answer, 
      { 
        quality: quality.score,
        source: 'chatgpt' 
      }
    );

    if (aiDecision.shouldStore) {
      console.log(`✅ AI decided to store: ${aiDecision.reasoning}`);
      
      // AI가 결정한 Tier와 메타데이터로 저장
      const learningData = {
        question,
        answer,
        keywords: await this.extractKeywords(question, answer),
        category: 'ai-curated',
        priority: Math.round(aiDecision.importanceScore * 10),
        tier: aiDecision.tier,
        metadata: {
          ...aiDecision.metadata,
          aiDecision: true,
          decayFunction: aiDecision.decayFunction,
          expectedLifespan: aiDecision.expectedLifespan
        }
      };

      await pineconeDao.addKnowledge(learningData);
      console.log(`📚 Stored in ${aiDecision.tier} tier with ${Math.round(aiDecision.importanceScore * 100)}% importance`);
    } else {
      console.log(`❌ AI decided NOT to store: ${aiDecision.reasoning}`);
    }

    return aiDecision;
  }

  // 🔄 기존 코드 수정: 사용자 피드백을 AI Decision Engine으로 연결
  async handleUserFeedback(messageId, feedback) {
    // 메시지에서 연관된 지식 ID 찾기
    const message = await messageDao.getMessageById(messageId);
    if (message && message.matched_knowledge_id) {
      // ✨ NEW: AI가 피드백을 처리하여 DB 업데이트
      await aiDecisionEngine.handleUserFeedback(
        message.matched_knowledge_id, 
        feedback
      );
    }
  }

  // 🔄 정기적 Time Decay 업데이트 추가
  async performScheduledLearning() {
    console.log('🕐 Starting enhanced scheduled learning...');
    
    // 기존 학습 로직
    await this.analyzeChatLogs();
    
    // ✨ NEW: Time Decay 적용
    await aiDecisionEngine.updateScoresWithTimeDecay();
    
    console.log('✅ Enhanced learning completed!');
  }
}
module.exports = new DynamicLearningService();
