// server/src/services/learningEngine.js
const learningDao = require('../dao/learningDao');
const pineconeDao = require('../dao/pineconeDao');
const knowledgeDao = require('../dao/knowledgeDao');
const OpenAI = require('openai');

class LearningEngine {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.isProcessing = false;
  }

  // 메인 학습 프로세스 (주기적으로 실행)
  async processLearningQueue() {
    if (this.isProcessing) {
      console.log('Learning process already running, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log('🧠 Starting learning process...');

    try {
      // 1. 대기 중인 학습 항목 가져오기
      const pendingItems = await learningDao.getPendingLearningItems(20);
      
      for (const item of pendingItems) {
        try {
          await learningDao.updateLearningStatus(item.id, 'processing');
          
          // 2. 답변 품질 분석
          const qualityScore = await this.analyzeAnswerQuality(item);
          
          // 3. 최적화가 필요한 경우
          if (qualityScore < 0.7 || item.user_feedback < 3) {
            await this.optimizeAnswer(item);
          }
          
          // 4. 자주 묻는 질문인 경우 Pinecone에 추가
          if (await this.isFrequentQuestion(item.user_message)) {
            await this.addToPinecone(item);
          }
          
          await learningDao.updateLearningStatus(item.id, 'completed');
        } catch (error) {
          console.error(`Error processing item ${item.id}:`, error);
          await learningDao.updateLearningStatus(item.id, 'failed');
        }
      }

      // 5. 질문 패턴 분석
      await this.analyzeQuestionPatterns();
      
      // 6. 답변 성능 최적화
      await this.optimizeAnswerPerformance();

    } catch (error) {
      console.error('Learning process error:', error);
    } finally {
      this.isProcessing = false;
      console.log('✅ Learning process completed');
    }
  }

  // 답변 품질 분석
  async analyzeAnswerQuality(learningItem) {
    try {
      const prompt = `
        질문: ${learningItem.user_message}
        답변: ${learningItem.bot_response}
        
        위 질문-답변 쌍의 품질을 0-1 사이의 점수로 평가해주세요.
        평가 기준:
        - 답변의 정확성
        - 답변의 완전성
        - 답변의 명확성
        - 질문과의 관련성
        
        점수만 숫자로 응답해주세요.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 10
      });

      return parseFloat(response.choices[0].message.content) || 0.5;
    } catch (error) {
      console.error('Quality analysis error:', error);
      return 0.5;
    }
  }

  // 답변 최적화
  async optimizeAnswer(learningItem) {
    try {
      const prompt = `
        원래 질문: ${learningItem.user_message}
        원래 답변: ${learningItem.bot_response}
        사용자 피드백 점수: ${learningItem.user_feedback || 'N/A'}
        
        위 답변을 개선해주세요. 더 정확하고, 완전하며, 도움이 되는 답변으로 만들어주세요.
        서울과학기술대학교 AI 챗봇의 답변임을 고려해주세요.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
      });

      const optimizedAnswer = response.choices[0].message.content;

      // 최적화 기록 저장
      await learningDao.saveOptimization({
        original_question: learningItem.user_message,
        original_answer: learningItem.bot_response,
        optimized_answer: optimizedAnswer,
        optimization_reason: 'Low quality score or negative feedback',
        improvement_score: 0.8
      });

      // Pinecone 업데이트
      if (learningItem.response_source === 'pinecone' && learningItem.matched_knowledge_id) {
        await this.updatePineconeAnswer(
          learningItem.matched_knowledge_id,
          optimizedAnswer
        );
      }

      return optimizedAnswer;
    } catch (error) {
      console.error('Optimization error:', error);
      return null;
    }
  }

  // 자주 묻는 질문 확인
  async isFrequentQuestion(question) {
    const patterns = await learningDao.getQuestionPatterns(7);
    
    // 유사도 기반 매칭
    for (const pattern of patterns) {
      if (this.calculateSimilarity(question, pattern.user_message) > 0.8) {
        return pattern.frequency > 5;
      }
    }
    
    return false;
  }

  // Pinecone에 추가
  async addToPinecone(learningItem) {
    try {
      // 키워드 추출
      const keywords = await this.extractKeywords(learningItem.user_message);
      
      // 카테고리 분류
      const category = await this.classifyCategory(learningItem.user_message);
      
      // Pinecone에 추가
      await pineconeDao.addKnowledge({
        question: learningItem.user_message,
        answer: learningItem.bot_response,
        keywords: keywords,
        category: category,
        priority: Math.min(10, learningItem.priority + 2),
        metadata: {
          source: 'auto-learned',
          confidence: learningItem.confidence_score,
          learnedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Added to Pinecone: ${learningItem.user_message.substring(0, 50)}...`);
    } catch (error) {
      console.error('Error adding to Pinecone:', error);
    }
  }

  // 질문 패턴 분석
  async analyzeQuestionPatterns() {
    try {
      const patterns = await learningDao.getQuestionPatterns(7);
      
      // 유사 질문 클러스터링
      const clusters = this.clusterQuestions(patterns);
      
      for (const cluster of clusters) {
        // 클러스터 대표 질문과 답변 생성
        const representativeQA = await this.generateRepresentativeQA(cluster);
        
        // 클러스터 정보 저장
        await learningDao.upsertQuestionCluster({
          cluster_name: cluster.name,
          representative_question: representativeQA.question,
          keywords: cluster.keywords.join(', '),
          member_count: cluster.members.length,
          avg_confidence: cluster.avgConfidence
        });
        
        // 높은 빈도의 클러스터는 Pinecone에 추가
        if (cluster.totalFrequency > 10) {
          await pineconeDao.addKnowledge({
            question: representativeQA.question,
            answer: representativeQA.answer,
            keywords: cluster.keywords.join(', '),
            category: await this.classifyCategory(representativeQA.question),
            priority: Math.min(10, Math.floor(cluster.totalFrequency / 10))
          });
        }
      }
    } catch (error) {
      console.error('Pattern analysis error:', error);
    }
  }

  // 답변 성능 최적화
  async optimizeAnswerPerformance() {
    try {
      // 성능이 낮은 답변들 찾기
      const lowPerformers = await knowledgeDao.searchAnswer('');
      
      for (const answer of lowPerformers) {
        const metrics = await learningDao.getAnswerPerformanceMetrics(answer.id);
        
        // 평균 평점이 낮거나 부정적 피드백이 많은 경우
        if (metrics.avg_rating < 3 || metrics.not_helpful_count > metrics.helpful_count) {
          // 답변 재생성
          const improvedAnswer = await this.regenerateAnswer(answer.question);
          
          if (improvedAnswer) {
            // Pinecone 업데이트
            await pineconeDao.updateKnowledge(answer.id, {
              answer: improvedAnswer,
              metadata: {
                lastOptimized: new Date().toISOString(),
                optimizationReason: 'Low performance metrics'
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('Performance optimization error:', error);
    }
  }

  // 유사도 계산 (간단한 구현)
  calculateSimilarity(text1, text2) {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  // 키워드 추출
  async extractKeywords(text) {
    try {
      const prompt = `
        다음 텍스트에서 핵심 키워드 5개를 추출해주세요:
        "${text}"
        
        쉼표로 구분해서 응답해주세요.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 50
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Keyword extraction error:', error);
      return '';
    }
  }

  // 카테고리 분류
  async classifyCategory(text) {
    const categories = [
      '학교소개', '입학', '학사', '캠퍼스생활', 
      '취업진로', '장학금', '학과정보', '기타'
    ];
    
    try {
      const prompt = `
        다음 질문을 아래 카테고리 중 하나로 분류해주세요:
        질문: "${text}"
        카테고리: ${categories.join(', ')}
        
        카테고리명만 응답해주세요.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 20
      });

      const category = response.choices[0].message.content.trim();
      return categories.includes(category) ? category : '기타';
    } catch (error) {
      console.error('Category classification error:', error);
      return '기타';
    }
  }

  // 질문 클러스터링 (간단한 구현)
  clusterQuestions(patterns) {
    const clusters = [];
    const processed = new Set();
    
    for (const pattern of patterns) {
      if (processed.has(pattern.user_message)) continue;
      
      const cluster = {
        name: `cluster_${clusters.length + 1}`,
        members: [pattern],
        keywords: [],
        totalFrequency: pattern.frequency,
        avgConfidence: pattern.avg_feedback
      };
      
      // 유사한 질문들 찾기
      for (const other of patterns) {
        if (!processed.has(other.user_message) && 
            this.calculateSimilarity(pattern.user_message, other.user_message) > 0.7) {
          cluster.members.push(other);
          cluster.totalFrequency += other.frequency;
          processed.add(other.user_message);
        }
      }
      
      processed.add(pattern.user_message);
      clusters.push(cluster);
    }
    
    return clusters;
  }

  // 대표 질문-답변 생성
  async generateRepresentativeQA(cluster) {
    try {
      const questions = cluster.members.map(m => m.user_message).join('\n');
      
      const prompt = `
        다음 유사한 질문들을 대표하는 하나의 질문과 종합적인 답변을 생성해주세요:
        
        질문들:
        ${questions}
        
        형식:
        질문: [대표 질문]
        답변: [종합적인 답변]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 300
      });

      const content = response.choices[0].message.content;
      const [questionPart, answerPart] = content.split('답변:');
      
      return {
        question: questionPart.replace('질문:', '').trim(),
        answer: answerPart.trim()
      };
    } catch (error) {
      console.error('Representative QA generation error:', error);
      return {
        question: cluster.members[0].user_message,
        answer: cluster.members[0].bot_response
      };
    }
  }

  // 답변 재생성
  async regenerateAnswer(question) {
    try {
      const prompt = `
        서울과학기술대학교 AI 챗봇으로서 다음 질문에 대해 정확하고 도움이 되는 답변을 작성해주세요:
        
        질문: ${question}
        
        답변은 친절하고 정확하며 구체적이어야 합니다.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 300
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Answer regeneration error:', error);
      return null;
    }
  }

  // Pinecone 답변 업데이트
  async updatePineconeAnswer(knowledgeId, newAnswer) {
    try {
      await pineconeDao.updateKnowledge(knowledgeId, {
        answer: newAnswer,
        metadata: {
          lastUpdated: new Date().toISOString(),
          updateReason: 'Auto-optimization based on user feedback'
        }
      });
    } catch (error) {
      console.error('Pinecone update error:', error);
    }
  }
}

module.exports = new LearningEngine();