// server/src/controllers/intelligentMessageController.js
const dynamicLearningService = require('../services/dynamicLearningService');
const vectorOptimizationService = require('../services/vectorOptimizationService');
const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const pineconeDao = require('../dao/pineconeDao');

class IntelligentMessageController {
  constructor() {
    this.responseQualityThreshold = 0.7;
    this.userFeedbackMap = new Map(); // 사용자 피드백 저장
    this.questionFrequency = new Map(); // 질문 빈도 추적
    
    // 정기 학습 스케줄러 (매일 자정)
    setInterval(() => {
      this.performDailyLearning();
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * 향상된 메시지 처리 시스템
   */
  async sendIntelligentMessage(req, res) {
    try {
      const { chat_room_id, content } = req.body;
      const startTime = Date.now();

      // 1. 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      // 2. 질문 빈도 추적
      this.trackQuestionFrequency(content);

      // 3. 최적화된 답변 생성
      const botResponse = await this.generateOptimizedResponse(content);
      const responseTime = Date.now() - startTime;

      // 4. 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse.answer
      });

      // 5. 응답 품질 모니터링
      await this.monitorResponseQuality(content, botResponse, responseTime);

      // 6. 채팅방 업데이트
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse.answer);

      // 7. 응답 반환
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseMetadata: {
          source: botResponse.source,
          confidence: botResponse.confidence,
          responseTime,
          suggestions: botResponse.suggestions
        }
      });

    } catch (error) {
      console.error('Intelligent message processing failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * 최적화된 답변 생성
   */
  async generateOptimizedResponse(userMessage) {
    console.log('🧠 Generating optimized response for:', userMessage);

    try {
      // 1. 의미적 캐싱으로 빠른 응답 시도
      const cachedResponse = await vectorOptimizationService.getAnswerWithSemanticCache(userMessage);
      if (cachedResponse) {
        return {
          answer: cachedResponse.answer,
          source: 'cache',
          confidence: cachedResponse.score,
          suggestions: []
        };
      }

      // 2. 최적화된 Pinecone 검색
      const pineconeResult = await vectorOptimizationService.optimizedSearch(userMessage);
      
      if (pineconeResult && pineconeResult.score >= 0.8) {
        return {
          answer: pineconeResult.answer,
          source: 'pinecone',
          confidence: pineconeResult.score,
          suggestions: await this.generateSuggestions(userMessage, pineconeResult)
        };
      }

      // 3. ChatGPT 호출 및 학습 데이터 수집
      const gptResponse = await this.callChatGPTWithLearning(userMessage);
      
      return {
        answer: gptResponse.answer,
        source: 'chatgpt',
        confidence: gptResponse.confidence,
        suggestions: []
      };

    } catch (error) {
      console.error('Response generation failed:', error);
      return {
        answer: this.getEmergencyResponse(userMessage),
        source: 'fallback',
        confidence: 0.5,
        suggestions: []
      };
    }
  }

  /**
   * 학습 기능이 포함된 ChatGPT 호출
   */
  async callChatGPTWithLearning(userMessage) {
    try {
      // ChatGPT API 호출
      const gptAnswer = await this.callChatGPT(userMessage);
      
      // 답변 품질 평가
      const quality = await this.evaluateResponseQuality(gptAnswer);
      
      // 고품질 답변인 경우 학습 후보로 등록
      if (quality.score >= this.responseQualityThreshold) {
        await this.addToLearningQueue(userMessage, gptAnswer, quality);
      }
      
      return {
        answer: gptAnswer,
        confidence: quality.score
      };

    } catch (error) {
      console.error('ChatGPT call failed:', error);
      throw error;
    }
  }

  /**
   * 학습 큐에 추가
   */
  async addToLearningQueue(question, answer, quality) {
    const learningData = {
      question,
      answer,
      quality: quality.score,
      timestamp: new Date(),
      source: 'chatgpt',
      needsReview: quality.score < 0.9 // 낮은 품질은 검토 필요
    };

    // Redis나 다른 큐 시스템에 저장
    // 여기서는 간단히 메모리에 저장
    if (!global.learningQueue) {
      global.learningQueue = [];
    }
    
    global.learningQueue.push(learningData);
    
    console.log(`📚 Added to learning queue: ${question.substring(0, 50)}...`);
  }

  /**
   * 답변 품질 평가
   */
  async evaluateResponseQuality(answer) {
    const metrics = {
      length: this.evaluateLength(answer),
      informativeness: this.evaluateInformativeness(answer),
      coherence: this.evaluateCoherence(answer),
      relevance: this.evaluateRelevance(answer)
    };

    const score = (
      metrics.length * 0.2 +
      metrics.informativeness * 0.3 +
      metrics.coherence * 0.25 +
      metrics.relevance * 0.25
    );

    return {
      score: Math.min(score, 1.0),
      metrics
    };
  }

  /**
   * 질문 빈도 추적
   */
  trackQuestionFrequency(question) {
    const normalizedQuestion = question.toLowerCase().trim();
    const currentCount = this.questionFrequency.get(normalizedQuestion) || 0;
    this.questionFrequency.set(normalizedQuestion, currentCount + 1);

    // 빈발 질문 감지 (5회 이상)
    if (currentCount + 1 >= 5) {
      console.log(`🔥 Frequent question detected: ${question}`);
      this.handleFrequentQuestion(question);
    }
  }

  /**
   * 빈발 질문 처리
   */
  async handleFrequentQuestion(question) {
    // 즉시 학습 후보로 등록
    const existingAnswer = await pineconeDao.searchAnswer(question, 1);
    
    if (!existingAnswer || existingAnswer.score < 0.8) {
      console.log(`⚡ Fast-tracking frequent question for learning: ${question}`);
      // 우선순위 학습 큐에 추가
      await this.addToPriorityLearningQueue(question);
    }
  }

  /**
   * 응답 품질 모니터링
   */
  async monitorResponseQuality(question, response, responseTime) {
    const qualityMetrics = {
      question,
      answer: response.answer,
      source: response.source,
      confidence: response.confidence,
      responseTime,
      timestamp: new Date()
    };

    // 성능 메트릭 저장
    if (!global.qualityMetrics) {
      global.qualityMetrics = [];
    }
    
    global.qualityMetrics.push(qualityMetrics);

    // 품질 임계값 체크
    if (response.confidence < 0.6) {
      console.warn(`⚠️ Low quality response detected: ${question}`);
      await this.handleLowQualityResponse(question, response);
    }
  }

  /**
   * 저품질 응답 처리
   */
  async handleLowQualityResponse(question, response) {
    // 1. 대체 검색 방법 시도
    const alternativeResponse = await this.tryAlternativeSearch(question);
    
    if (alternativeResponse) {
      console.log('✅ Found alternative response');
      return alternativeResponse;
    }

    // 2. 사용자에게 피드백 요청 (추후 구현)
    // await this.requestUserFeedback(question, response);

    // 3. 관리자에게 알림 (추후 구현)
    // await this.notifyAdministrator(question, response);
  }

  /**
   * 일일 학습 수행
   */
  async performDailyLearning() {
    console.log('🌅 Starting daily learning process...');
    
    try {
      // 1. 동적 학습 실행
      const learningResults = await dynamicLearningService.analyzeChatLogs();
      
      // 2. 인덱스 최적화
      await vectorOptimizationService.optimizeIndex();
      
      // 3. 성능 메트릭 분석
      const performanceMetrics = await vectorOptimizationService.monitorPerformance();
      
      // 4. 학습 리포트 생성
      const report = {
        date: new Date().toISOString().split('T')[0],
        newKnowledgeItems: learningResults.length,
        performanceMetrics,
        qualityImprovements: await this.calculateQualityImprovements()
      };
      
      console.log('📊 Daily Learning Report:', report);
      
      // 5. 관리자에게 리포트 전송 (추후 구현)
      // await this.sendDailyReport(report);
      
    } catch (error) {
      console.error('❌ Daily learning failed:', error);
    }
  }

  /**
   * 사용자 피드백 처리
   */
  async handleUserFeedback(req, res) {
    try {
      const { messageId, feedback, rating } = req.body;
      
      // 피드백 저장
      this.userFeedbackMap.set(messageId, {
        feedback,
        rating,
        timestamp: new Date()
      });
      
      // 부정적 피드백인 경우 즉시 학습
      if (rating < 3) {
        const message = await messageDao.getMessageById(messageId);
        await this.improveResponse(message);
      }
      
      res.json({ message: 'Feedback received successfully' });
      
    } catch (error) {
      console.error('Feedback handling failed:', error);
      res.status(500).json({ error: 'Failed to process feedback' });
    }
  }

  // 헬퍼 메서드들
  evaluateLength(answer) {
    const length = answer.length;
    if (length < 30) return 0.3;
    if (length < 100) return 0.6;
    if (length < 300) return 1.0;
    if (length < 500) return 0.9;
    return 0.7; // 너무 길면 감점
  }

  evaluateInformativeness(answer) {
    const informativeKeywords = [
      '방법', '절차', '요건', '기준', '조건', '가능', '필요', '신청', '접수',
      '시간', '장소', '연락처', '홈페이지', '문의', '담당', '부서'
    ];
    
    const foundKeywords = informativeKeywords.filter(keyword => 
      answer.includes(keyword)
    ).length;
    
    return Math.min(foundKeywords / 5, 1.0);
  }

  evaluateCoherence(answer) {
    // 간단한 문장 구조 분석
    const sentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
    
    // 적절한 문장 길이 (20-80자)
    if (avgSentenceLength >= 20 && avgSentenceLength <= 80) {
      return 1.0;
    } else if (avgSentenceLength >= 10 && avgSentenceLength <= 120) {
      return 0.7;
    } else {
      return 0.4;
    }
  }

  evaluateRelevance(answer) {
    // 부정적 표현 체크
    const negativePatterns = [
      '모르겠', '확인할 수 없', '죄송', '정확하지 않', '찾을 수 없'
    ];
    
    const hasNegative = negativePatterns.some(pattern => answer.includes(pattern));
    return hasNegative ? 0.3 : 1.0;
  }

  getEmergencyResponse(userMessage) {
    return `죄송합니다. "${userMessage}"에 대한 정확한 답변을 제공하기 어렵습니다. 학교 홈페이지(www.seoultech.ac.kr)를 참고하시거나, 학생지원팀(02-970-6041)으로 문의해 주세요.`;
  }
}

module.exports = new IntelligentMessageController();