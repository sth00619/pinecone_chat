// server/src/services/aiDecisionEngine.js
const pineconeDao = require('../dao/pineconeDao');
const OpenAI = require('openai');

/**
 * 🤖 AI가 정보의 중요도와 생명주기를 판단하여 DB 저장 여부를 결정
 * 
 * YOUR REQUIREMENTS MAPPED:
 * 1. AI decides what information to add to DB ✅
 * 2. Time decay scoring (short/mid/long term) ✅  
 * 3. User feedback integration ✅
 * 4. Tier-based lifecycle management ✅
 */

class AIDecisionEngine {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // 🎯 당신이 요청한 3-Tier 시스템
    this.informationTiers = {
      SHORT_TERM: {
        name: 'short_term',
        examples: ['tomorrow schedule', 'today weather', 'current events'],
        decayRate: 0.5,        // 50% per day - 빠른 감소
        maxLifespan: 7,        // 7일 후 삭제
        priority: 3
      },
      
      MID_TERM: {
        name: 'mid_term', 
        examples: ['1 year plan', 'semester schedule', 'project deadlines'],
        decayRate: 0.05,       // 5% per day - 중간 감소
        maxLifespan: 365,      // 1년 후 아카이브
        priority: 7
      },
      
      LONG_TERM: {
        name: 'long_term',
        examples: ['birthday', 'password policy', 'graduation requirements'],
        decayRate: 0.001,      // 0.1% per day - 매우 느린 감소
        maxLifespan: 3650,     // 10년 후 아카이브
        priority: 10
      }
    };

    this.userFeedbackWeight = 2.0; // 사용자 피드백의 가중치
  }

  /**
   * 🧠 AI가 정보 저장 여부를 결정하는 핵심 함수
   * 
   * 이것이 당신이 원했던 "AI doing what information to add on DB" 입니다!
   */
  async shouldStoreInformation(question, answer, context = {}) {
    console.log('🤖 AI analyzing storage decision for:', question.substring(0, 50) + '...');

    try {
      // 1. AI가 정보의 특성을 분석
      const analysis = await this.analyzeInformationCharacteristics(question, answer);
      
      // 2. AI가 중요도 점수를 계산
      const importanceScore = await this.calculateImportanceScore(question, answer, analysis);
      
      // 3. AI가 적절한 Tier를 결정
      const selectedTier = await this.selectInformationTier(question, answer, analysis);
      
      // 4. 사용자 피드백이 있다면 반영
      const adjustedScore = this.applyUserFeedback(importanceScore, context.userFeedback);
      
      // 5. 최종 저장 결정
      const decision = {
        shouldStore: adjustedScore >= 0.6, // 60% 이상이면 저장
        tier: selectedTier,
        importanceScore: adjustedScore,
        reasoning: analysis.reasoning,
        decayFunction: this.getDecayFunction(selectedTier),
        expectedLifespan: this.informationTiers[selectedTier].maxLifespan,
        metadata: {
          aiAnalysis: analysis,
          decisionTimestamp: new Date().toISOString(),
          initialScore: importanceScore,
          adjustedScore: adjustedScore
        }
      };

      console.log(`🎯 AI Decision: ${decision.shouldStore ? 'STORE' : 'SKIP'} (${Math.round(adjustedScore * 100)}% importance, ${selectedTier} tier)`);
      
      return decision;

    } catch (error) {
      console.error('❌ AI decision failed:', error);
      // 안전한 폴백: 중간 점수로 저장
      return {
        shouldStore: true,
        tier: 'MID_TERM',
        importanceScore: 0.7,
        reasoning: 'AI analysis failed, using safe defaults'
      };
    }
  }

  /**
   * 🔍 AI가 정보의 특성을 심층 분석
   */
  async analyzeInformationCharacteristics(question, answer) {
    const prompt = `
    다음 질문과 답변을 분석하여 정보의 특성을 판단해주세요:

    질문: ${question}
    답변: ${answer}

    분석 기준:
    1. 시간 민감성 (0.0-1.0): 시간이 지나면 무의미해지는가?
    2. 재사용성 (0.0-1.0): 다른 사용자들에게도 유용한가?
    3. 구체성 (0.0-1.0): 구체적이고 실용적인 정보인가?
    4. 개인성 (0.0-1.0): 개인적인 정보인가 일반적인 정보인가?
    5. 중요도 (0.0-1.0): 전반적으로 얼마나 중요한 정보인가?

    카테고리 판단:
    - SHORT_TERM: 일시적, 빠르게 변하는 정보 (일정, 날씨, 임시 공지사항)
    - MID_TERM: 중기적으로 유용한 정보 (학기 정보, 프로젝트, 정책)  
    - LONG_TERM: 오래 유지되는 기본 정보 (규정, 연락처, 기본 절차)

    JSON 형식으로 응답:
    {
      "timeSensitivity": 0.8,
      "reusability": 0.7,
      "specificity": 0.9,
      "privacy": 0.2,
      "importance": 0.8,
      "suggestedTier": "MID_TERM",
      "reasoning": "이 정보는...",
      "keywords": ["키워드1", "키워드2"],
      "personalInfo": false
    }
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 500
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Analysis failed:', error);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * 📊 AI가 중요도 점수를 계산
   */
  async calculateImportanceScore(question, answer, analysis) {
    // 복합 점수 계산 (당신의 요구사항에 따라)
    const weights = {
      reusability: 0.3,      // 재사용성이 가장 중요
      importance: 0.25,      // 전반적 중요도
      specificity: 0.2,      // 구체성
      timeSensitivity: -0.15, // 시간 민감성은 감점 요소
      privacy: -0.1          // 개인정보는 감점 요소
    };

    let score = 0;
    for (const [factor, weight] of Object.entries(weights)) {
      if (analysis[factor] !== undefined) {
        score += analysis[factor] * weight;
      }
    }

    // 질문 길이 보정 (너무 짧은 질문은 감점)
    if (question.length < 10) {
      score *= 0.8;
    }

    // 답변 품질 보정 (너무 짧은 답변은 감점)
    if (answer.length < 30) {
      score *= 0.7;
    }

    return Math.max(0, Math.min(1, score)); // 0-1 범위로 제한
  }

  /**
   * 🎯 AI가 적절한 Tier를 선택
   */
  async selectInformationTier(question, answer, analysis) {
    // AI 분석 결과 우선 사용
    if (analysis.suggestedTier && this.informationTiers[analysis.suggestedTier]) {
      return analysis.suggestedTier;
    }

    // 폴백 로직: 시간 민감성 기반
    if (analysis.timeSensitivity > 0.8) {
      return 'SHORT_TERM';
    } else if (analysis.timeSensitivity > 0.3) {
      return 'MID_TERM'; 
    } else {
      return 'LONG_TERM';
    }
  }

  /**
   * 👤 사용자 피드백 반영 (당신이 요청한 기능!)
   */
  applyUserFeedback(baseScore, userFeedback) {
    if (!userFeedback) return baseScore;

    let adjustmentFactor = 1.0;

    // 부정적 피드백 처리
    if (userFeedback.isWrong === true || userFeedback.rating < 3) {
      adjustmentFactor = 0.3; // 점수를 크게 감소
      console.log('👎 User reported wrong answer - reducing score significantly');
    }
    // 긍정적 피드백 처리  
    else if (userFeedback.rating >= 4) {
      adjustmentFactor = 1.3; // 점수를 증가
      console.log('👍 User liked answer - boosting score');
    }

    const adjustedScore = Math.min(1.0, baseScore * adjustmentFactor);
    return adjustedScore;
  }

  /**
   * ⏰ Time Decay 함수 생성 (당신이 요청한 핵심 기능!)
   */
  getDecayFunction(tier) {
    const tierConfig = this.informationTiers[tier];
    
    return {
      calculateCurrentScore: (originalScore, daysElapsed) => {
        // 지수적 감소 공식: score = original * e^(-decayRate * time)
        const currentScore = originalScore * Math.exp(-tierConfig.decayRate * daysElapsed);
        return Math.max(0.1, currentScore); // 최소 0.1은 유지
      },
      
      shouldArchive: (daysElapsed) => {
        return daysElapsed >= tierConfig.maxLifespan;
      },
      
      getDecayRate: () => tierConfig.decayRate,
      getMaxLifespan: () => tierConfig.maxLifespan
    };
  }

  /**
   * 🔄 기존 정보의 점수 업데이트 (Time Decay 적용)
   */
  async updateScoresWithTimeDecay() {
    console.log('⏰ Updating scores with time decay...');

    try {
      // Pinecone에서 모든 지식 조회
      const allKnowledge = await pineconeDao.getAllKnowledge('', 1000);
      
      const updates = [];
      const toArchive = [];
      
      for (const item of allKnowledge) {
        if (!item.createdAt || !item.tier) continue;
        
        const daysElapsed = this.calculateDaysElapsed(item.createdAt);
        const decayFunction = this.getDecayFunction(item.tier);
        
        // 아카이브 여부 확인
        if (decayFunction.shouldArchive(daysElapsed)) {
          toArchive.push(item.id);
          continue;
        }
        
        // 새로운 점수 계산
        const originalScore = item.priority || 5;
        const newScore = decayFunction.calculateCurrentScore(originalScore, daysElapsed);
        
        if (Math.abs(newScore - originalScore) > 0.1) {
          updates.push({
            id: item.id,
            newScore: Math.round(newScore),
            daysElapsed
          });
        }
      }
      
      // 점수 업데이트 실행
      for (const update of updates) {
        await pineconeDao.updateKnowledge(update.id, {
          priority: update.newScore,
          lastDecayUpdate: new Date().toISOString()
        });
      }
      
      // 아카이브 실행
      if (toArchive.length > 0) {
        await pineconeDao.deleteKnowledge(toArchive);
        console.log(`📦 Archived ${toArchive.length} expired items`);
      }
      
      console.log(`✅ Updated ${updates.length} scores, archived ${toArchive.length} items`);
      
    } catch (error) {
      console.error('❌ Score update failed:', error);
    }
  }

  /**
   * 📝 사용자 피드백 처리 및 DB 업데이트
   */
  async handleUserFeedback(knowledgeId, feedback) {
    console.log(`📝 Processing user feedback for ${knowledgeId}:`, feedback);

    try {
      const knowledge = await pineconeDao.getKnowledgeById(knowledgeId);
      if (!knowledge) {
        console.warn('Knowledge not found for feedback');
        return;
      }

      // 현재 점수 가져오기
      const currentScore = knowledge.priority || 5;
      
      // 피드백 적용
      const adjustedScore = this.applyUserFeedback(currentScore / 10, feedback) * 10;
      
      // 피드백이 매우 부정적이면 삭제 고려
      if (feedback.isWrong === true || feedback.rating <= 2) {
        console.log('🗑️ Very negative feedback - marking for review/deletion');
        
        await pineconeDao.updateKnowledge(knowledgeId, {
          priority: Math.max(1, adjustedScore),
          needsReview: true,
          lastFeedback: feedback,
          lastFeedbackDate: new Date().toISOString()
        });
      } else {
        // 일반적인 점수 조정
        await pineconeDao.updateKnowledge(knowledgeId, {
          priority: Math.round(adjustedScore),
          lastFeedback: feedback,
          lastFeedbackDate: new Date().toISOString()
        });
      }

      console.log(`✅ Updated score from ${currentScore} to ${Math.round(adjustedScore)}`);

    } catch (error) {
      console.error('❌ Feedback processing failed:', error);
    }
  }

  // 헬퍼 메서드들
  calculateDaysElapsed(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    return Math.floor((now - created) / (1000 * 60 * 60 * 24));
  }

  getDefaultAnalysis() {
    return {
      timeSensitivity: 0.5,
      reusability: 0.5,
      specificity: 0.5,
      privacy: 0.5,
      importance: 0.5,
      suggestedTier: 'MID_TERM',
      reasoning: 'Default analysis due to AI failure'
    };
  }
}

module.exports = new AIDecisionEngine();