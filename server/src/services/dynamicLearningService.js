// server/src/services/dynamicLearningService.js
const pineconeDao = require('../dao/pineconeDao');
const messageDao = require('../dao/messageDao');

class DynamicLearningService {
  constructor() {
    this.learningThresholds = {
      MIN_FREQUENCY: 3,        // 최소 3번 이상 질문된 경우
      MIN_CONFIDENCE: 0.7,     // ChatGPT 응답 신뢰도 70% 이상
      MIN_INTERVAL_HOURS: 24,  // 24시간 간격으로 학습
      MAX_SIMILAR_DISTANCE: 0.8 // 유사 질문 임계값
    };
    
    this.questionPatterns = new Map(); // 질문 패턴 캐시
    this.lastLearningTime = new Date();
  }

  /**
   * 채팅 로그 분석 및 학습 데이터 추출
   */
  async analyzeChatLogs() {
    console.log('🧠 Starting dynamic learning analysis...');
    
    try {
      // 1. 최근 채팅 로그에서 패턴 분석
      const frequentQuestions = await this.findFrequentQuestions();
      
      // 2. 유용한 질문-답변 쌍 식별
      const learningCandidates = await this.identifyLearningCandidates(frequentQuestions);
      
      // 3. 중복 제거 및 품질 검증
      const validatedData = await this.validateLearningData(learningCandidates);
      
      // 4. Pinecone DB 업데이트
      const updateResults = await this.updateKnowledgeBase(validatedData);
      
      console.log(`✅ Learning completed: ${updateResults.length} new knowledge items added`);
      return updateResults;
      
    } catch (error) {
      console.error('❌ Dynamic learning failed:', error);
      throw error;
    }
  }

  /**
   * 자주 묻는 질문 패턴 분석
   */
  async findFrequentQuestions() {
    const query = `
      SELECT 
        m.content as question,
        COUNT(*) as frequency,
        GROUP_CONCAT(bot_m.content SEPARATOR '|||') as answers,
        AVG(CHAR_LENGTH(bot_m.content)) as avg_answer_length,
        MAX(m.created_at) as last_asked
      FROM messages m
      JOIN messages bot_m ON bot_m.chat_room_id = m.chat_room_id 
        AND bot_m.message_order = m.message_order + 1
        AND bot_m.role = 'bot'
      WHERE m.role = 'user' 
        AND m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND CHAR_LENGTH(m.content) > 10  -- 의미있는 질문만
        AND bot_m.content NOT LIKE '%찾을 수 없습니다%'  -- 기본 응답 제외
      GROUP BY LOWER(TRIM(m.content))
      HAVING frequency >= ?
        AND avg_answer_length > 50  -- 충분한 길이의 답변
      ORDER BY frequency DESC, last_asked DESC
      LIMIT 100
    `;
    
    const [rows] = await pool.query(query, [this.learningThresholds.MIN_FREQUENCY]);
    
    return rows.map(row => ({
      question: row.question,
      frequency: row.frequency,
      answers: row.answers.split('|||'),
      avgAnswerLength: row.avg_answer_length,
      lastAsked: row.last_asked,
      normalizedQuestion: this.normalizeQuestion(row.question)
    }));
  }

  /**
   * 학습 후보 데이터 식별
   */
  async identifyLearningCandidates(frequentQuestions) {
    const candidates = [];
    
    for (const item of frequentQuestions) {
      // 답변 품질 분석
      const bestAnswer = await this.selectBestAnswer(item.answers);
      
      if (bestAnswer && bestAnswer.confidence >= this.learningThresholds.MIN_CONFIDENCE) {
        // 기존 DB에 유사한 질문이 있는지 확인
        const similarExists = await this.checkSimilarQuestionExists(item.normalizedQuestion);
        
        if (!similarExists) {
          candidates.push({
            question: item.question,
            answer: bestAnswer.content,
            confidence: bestAnswer.confidence,
            frequency: item.frequency,
            keywords: await this.extractAdvancedKeywords(item.question, bestAnswer.content),
            category: await this.classifyCategory(item.question, bestAnswer.content),
            priority: this.calculatePriority(item.frequency, bestAnswer.confidence),
            metadata: {
              source: 'dynamic-learning',
              frequency: item.frequency,
              lastAsked: item.lastAsked,
              learningDate: new Date().toISOString()
            }
          });
        }
      }
    }
    
    return candidates;
  }

  /**
   * 최적 답변 선택 (여러 답변 중에서)
   */
  async selectBestAnswer(answers) {
    if (!answers || answers.length === 0) return null;
    
    // 답변들을 분석하여 가장 좋은 답변 선택
    const analyzedAnswers = await Promise.all(
      answers.map(async (answer) => {
        const analysis = await this.analyzeAnswerQuality(answer);
        return {
          content: answer,
          confidence: analysis.confidence,
          completeness: analysis.completeness,
          relevance: analysis.relevance
        };
      })
    );
    
    // 종합 점수로 정렬
    analyzedAnswers.sort((a, b) => 
      (b.confidence * 0.4 + b.completeness * 0.3 + b.relevance * 0.3) - 
      (a.confidence * 0.4 + a.completeness * 0.3 + a.relevance * 0.3)
    );
    
    return analyzedAnswers[0];
  }

  /**
   * 답변 품질 분석
   */
  async analyzeAnswerQuality(answer) {
    // 1. 길이 기반 완성도
    const completeness = Math.min(answer.length / 200, 1.0);
    
    // 2. 정보성 키워드 포함 여부
    const informativeWords = ['방법', '절차', '요건', '기준', '조건', '가능', '필요', '신청', '접수'];
    const relevance = informativeWords.filter(word => answer.includes(word)).length / informativeWords.length;
    
    // 3. 부정적 표현 확인
    const negativePatterns = ['모르겠', '확인할 수 없', '죄송', '정확하지 않'];
    const hasNegative = negativePatterns.some(pattern => answer.includes(pattern));
    
    // 4. 구체적 정보 포함 여부 (숫자, 날짜, 장소 등)
    const hasSpecificInfo = /\d+|월|일|층|호|번지|시간|분|원/.test(answer);
    
    const confidence = hasNegative ? 0.3 : 
      (completeness * 0.3 + relevance * 0.3 + (hasSpecificInfo ? 0.4 : 0.1));
    
    return {
      confidence: Math.min(confidence, 1.0),
      completeness,
      relevance
    };
  }

  /**
   * 고급 키워드 추출 (TF-IDF 기반)
   */
  async extractAdvancedKeywords(question, answer) {
    const text = `${question} ${answer}`;
    
    // 불용어 제거
    const stopWords = new Set([
      '은', '는', '이', '가', '을', '를', '에', '에서', '으로', '와', '과', '의', '도', '만', '까지', '부터',
      '그', '저', '이것', '그것', '여기', '거기', '어디', '언제', '어떻게', '왜', '무엇', '누구',
      '있다', '없다', '하다', '되다', '아니다', '말하다', '보다', '주다', '받다', '가다', '오다'
    ]);
    
    // 단어 분리 및 필터링
    const words = text.match(/[가-힣]{2,}|[a-zA-Z]{3,}|\d+/g) || [];
    const filteredWords = words.filter(word => 
      !stopWords.has(word) && 
      word.length >= 2 && 
      word.length <= 10
    );
    
    // 빈도 계산
    const wordCount = {};
    filteredWords.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // 상위 키워드 선택
    const keywords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
    
    return keywords.join(', ');
  }

  /**
   * 카테고리 자동 분류
   */
  async classifyCategory(question, answer) {
    const categoryKeywords = {
      '학교소개': ['역사', '설립', '위치', '캠퍼스', '상징', '교훈', '소개'],
      '입학': ['입학', '전형', '모집', '지원', '접수', '경쟁률', '합격'],
      '학사': ['학점', '졸업', '수강', '전공', '교양', '학기', '성적'],
      '캠퍼스생활': ['기숙사', '생활관', '도서관', '식당', '동아리', '학생회'],
      '취업진로': ['취업', '진로', '인턴', '채용', '산학협력', '취업률'],
      '장학금': ['장학금', '장학', '학비', '등록금', '지원금', '혜택']
    };
    
    const text = `${question} ${answer}`.toLowerCase();
    let bestCategory = 'general';
    let maxScore = 0;
    
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      const score = keywords.filter(keyword => text.includes(keyword)).length;
      if (score > maxScore) {
        maxScore = score;
        bestCategory = category;
      }
    }
    
    return maxScore > 0 ? bestCategory : 'general';
  }

  /**
   * 우선순위 계산
   */
  calculatePriority(frequency, confidence) {
    // 빈도와 신뢰도를 고려한 우선순위 계산
    const frequencyScore = Math.min(frequency / 10, 1) * 5; // 최대 5점
    const confidenceScore = confidence * 5; // 최대 5점
    return Math.round(frequencyScore + confidenceScore);
  }

  /**
   * 기존 DB에 유사한 질문이 있는지 확인
   */
  async checkSimilarQuestionExists(normalizedQuestion) {
    try {
      const result = await pineconeDao.searchAnswer(normalizedQuestion, 1);
      return result && result.score >= this.learningThresholds.MAX_SIMILAR_DISTANCE;
    } catch (error) {
      console.warn('Failed to check similar question:', error);
      return false;
    }
  }

  /**
   * 질문 정규화
   */
  normalizeQuestion(question) {
    return question
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 학습 데이터 검증
   */
  async validateLearningData(candidates) {
    return candidates.filter(candidate => {
      // 최소 품질 기준 확인
      if (candidate.confidence < this.learningThresholds.MIN_CONFIDENCE) return false;
      if (candidate.answer.length < 50) return false;
      if (candidate.frequency < this.learningThresholds.MIN_FREQUENCY) return false;
      
      // 민감한 개인정보 포함 여부 확인
      const sensitivePatterns = [
        /\d{4}-\d{4}-\d{4}-\d{4}/, // 카드번호
        /\d{3}-\d{4}-\d{4}/,       // 전화번호
        /\w+@\w+\.\w+/,            // 이메일
        /주민등록번호|비밀번호|계좌번호/
      ];
      
      const text = `${candidate.question} ${candidate.answer}`;
      const hasSensitiveInfo = sensitivePatterns.some(pattern => pattern.test(text));
      
      return !hasSensitiveInfo;
    });
  }

  /**
   * 지식베이스 업데이트
   */
  async updateKnowledgeBase(validatedData) {
    if (validatedData.length === 0) {
      console.log('ℹ️ No new knowledge to add');
      return [];
    }
    
    console.log(`📚 Adding ${validatedData.length} new knowledge items...`);
    
    try {
      const ids = await pineconeDao.addKnowledgeBatch(validatedData);
      
      // 학습 로그 저장
      await this.logLearningActivity(validatedData);
      
      return ids;
    } catch (error) {
      console.error('Failed to update knowledge base:', error);
      throw error;
    }
  }

  /**
   * 학습 활동 로그
   */
  async logLearningActivity(learnedData) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      itemsLearned: learnedData.length,
      categories: [...new Set(learnedData.map(item => item.category))],
      avgConfidence: learnedData.reduce((sum, item) => sum + item.confidence, 0) / learnedData.length,
      totalFrequency: learnedData.reduce((sum, item) => sum + item.frequency, 0)
    };
    
    console.log('📊 Learning Activity Log:', logEntry);
    
    // 필요시 DB에 학습 로그 저장
    // await knowledgeDao.saveLearningLog(logEntry);
  }

  /**
   * 정기적 학습 실행 (스케줄러에서 호출)
   */
  async performScheduledLearning() {
    const now = new Date();
    const hoursSinceLastLearning = (now - this.lastLearningTime) / (1000 * 60 * 60);
    
    if (hoursSinceLastLearning >= this.learningThresholds.MIN_INTERVAL_HOURS) {
      console.log('🕐 Starting scheduled learning...');
      await this.analyzeChatLogs();
      this.lastLearningTime = now;
    }
  }
}

module.exports = new DynamicLearningService();