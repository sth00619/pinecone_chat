// server/src/controllers/intelligentMessageController.js
const dynamicLearningService = require('../services/dynamicLearningService');
const vectorOptimizationService = require('../services/vectorOptimizationService');
const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const pineconeDao = require('../dao/pineconeDao');

const aiDecisionEngine = require('../services/aiDecisionEngine');

class IntelligentMessageController {
  
  // 🔄 기존 코드 수정: ChatGPT 응답을 AI가 평가 후 저장
  async callChatGPTWithAILearning(userMessage) {
    try {
      // ChatGPT 
      const gptAnswer = await this.callChatGPT(userMessage);
      
      // ✨ NEW: AI가 저장할 가치가 있는지 즉시 판단
      const aiDecision = await aiDecisionEngine.shouldStoreInformation(
        userMessage,
        gptAnswer,
        { source: 'chatgpt', realtime: true }
      );

      if (aiDecision.shouldStore) {
        console.log(`🤖 AI: This answer is worth storing! (${Math.round(aiDecision.importanceScore * 100)}% importance)`);
        
        // 즉시 저장 (빠른 학습)
        await pineconeDao.addKnowledge({
          question: userMessage,
          answer: gptAnswer,
          keywords: await this.extractKeywords(userMessage, gptAnswer),
          category: 'ai-realtime',
          priority: Math.round(aiDecision.importanceScore * 10),
          tier: aiDecision.tier,
          metadata: aiDecision.metadata
        });
      } else {
        console.log(`🤖 AI: Not worth storing - ${aiDecision.reasoning}`);
      }

      return {
        answer: gptAnswer,
        confidence: aiDecision.importanceScore,
        aiDecision: aiDecision
      };

    } catch (error) {
      console.error('Enhanced ChatGPT call failed:', error);
      throw error;
    }
  }

  // ✨ NEW: 사용자 피드백 처리
  async handleEnhancedUserFeedback(req, res) {
    try {
      const { messageId, feedback, rating, isWrong } = req.body;
      
      // ✨ AI Decision Engine으로 피드백 전달
      const message = await messageDao.getMessageById(messageId);
      if (message && message.matched_knowledge_id) {
        await aiDecisionEngine.handleUserFeedback(
          message.matched_knowledge_id,
          { rating, isWrong, feedback, timestamp: new Date() }
        );
      }
      
      res.json({ 
        message: 'AI processed your feedback and updated the knowledge base',
        aiProcessed: true 
      });
      
    } catch (error) {
      console.error('Enhanced feedback handling failed:', error);
      res.status(500).json({ error: 'Failed to process feedback' });
    }
  }

  // ✨ NEW: Tier별 응답 전략
  async selectResponseStrategy(userMessage) {
    // 질문의 시급성을 AI가 판단
    const urgencyAnalysis = await aiDecisionEngine.analyzeInformationCharacteristics(
      userMessage, 
      ""
    );

    if (urgencyAnalysis.timeSensitivity > 0.8) {
      // 매우 시급한 질문 - 캐시 우선 검색
      return 'urgent_cache_first';
    } else if (urgencyAnalysis.timeSensitivity > 0.3) {
      // 중간 시급성 - 일반적인 검색
      return 'normal_search';
    } else {
      // 시급하지 않음 - 정확도 우선 검색
      return 'accuracy_first';
    }
  }
}

module.exports = new IntelligentMessageController();