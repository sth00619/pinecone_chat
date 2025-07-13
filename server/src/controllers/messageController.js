const redis = require('../config/redis');
const personalDataDao = require('../dao/personalDataDao');
const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const knowledgeDao = require('../dao/knowledgeDao');
const pineconeDao = require('../dao/pineconeDao');
const learningDao = require('../dao/learningDao');
const axios = require('axios');
const crypto = require('crypto');

// ChatGPT API 호출 함수
async function askChatGPT(userMessage) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'I am your personal Secretary.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('ChatGPT API Error:', error.response?.data || error.message);
    throw error;
  }
}

class MessageController {
  constructor() {
    // 메서드들을 this에 바인딩
    this.getMessages = this.getMessages.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.deleteMessage = this.deleteMessage.bind(this);
    this.getHelp = this.getHelp.bind(this);
    this.handleUserFeedback = this.handleUserFeedback.bind(this);
    this.handleMessageFeedback = this.handleMessageFeedback.bind(this);
    this.analyzeSession = this.analyzeSession.bind(this);
    this.generateBotResponse = this.generateBotResponse.bind(this);
    this.generateBotResponseFromDB = this.generateBotResponseFromDB.bind(this);
    this.addToLearningQueue = this.addToLearningQueue.bind(this);
    this.saveGPTResponseToPinecone = this.saveGPTResponseToPinecone.bind(this);
    this.extractKeywords = this.extractKeywords.bind(this);
    this.getDefaultResponse = this.getDefaultResponse.bind(this);
    this.evaluateSessionQuality = this.evaluateSessionQuality.bind(this);
    this.queueSessionForLearning = this.queueSessionForLearning.bind(this);
    
    // 새로운 메서드들 바인딩
    this.syncPineconeToRDBMS = this.syncPineconeToRDBMS.bind(this);
    this.manageCacheWithPersonalData = this.manageCacheWithPersonalData.bind(this);
    this.generateCacheKey = this.generateCacheKey.bind(this);
    this.updateRDBMSFromPineconePerformance = this.updateRDBMSFromPineconePerformance.bind(this);
    this.analyzePineconePerformance = this.analyzePineconePerformance.bind(this);
  }

  // 채팅방의 메시지 목록 조회
  async getMessages(req, res) {
    try {
      const { chatRoomId } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      // 채팅방 존재 확인
      const chatRoom = await chatRoomDao.getChatRoomById(chatRoomId);
      if (!chatRoom) {
        return res.status(404).json({ error: 'Chat room not found' });
      }

      const messages = await messageDao.getMessagesByChatRoomId(
        chatRoomId, 
        parseInt(limit), 
        parseInt(offset)
      );
      
      res.json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // 캐시 키 생성 함수
  generateCacheKey(content) {
    const hash = crypto.createHash('md5');
    hash.update(content.toLowerCase().trim());
    return hash.digest('hex').substring(0, 16);
  }

  // 개인정보와 캐시 관리
  async manageCacheWithPersonalData(content, hasPersonalData) {
    const cacheKey = `chat:${this.generateCacheKey(content)}`;
    
    if (hasPersonalData) {
      // Remove from cache if personal data detected
      try {
        await redis.del(cacheKey);
        console.log('🔐 Removed from cache due to personal data');
      } catch (error) {
        console.error('Cache removal error:', error);
      }
      return null;
    }
    
    // Normal cache operations for non-personal data
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Cache get error:', error);
    }
    
    return null;
  }

  // 개인정보 감지 및 처리를 위한 메인 메시지 전송 메서드
  async sendMessage(req, res) {
    try {
      console.log('sendMessage called with:', req.body);
      const startTime = Date.now();
      const { chat_room_id, content } = req.body;
      const userId = req.userId; // authMiddleware에서 설정

      // 입력 검증
      if (!chat_room_id || !content) {
        return res.status(400).json({ error: 'chat_room_id and content are required' });
      }

      // 1. 개인정보 감지 및 처리 (강화된 버전 사용)
      const personalData = personalDataDao.detectPersonalDataWithContext(content);
      if (personalData.length > 0) {
        console.log('🔐 개인정보 감지됨:', personalData);
        
        // 개인정보를 RDBMS에 저장
        for (const data of personalData) {
          await personalDataDao.savePersonalData(
            userId,
            data.type,
            data.value,
            { 
              originalMessage: content,
              chatRoomId: chat_room_id,
              confidence: data.confidence
            }
          );
        }
      }

      // 2. Redis 캐시 확인 (개인정보가 없는 경우만) - 강화된 버전
      let cachedResponse = await this.manageCacheWithPersonalData(content, personalData.length > 0);

      // 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      let botResponse, matchedId, source;

      if (cachedResponse) {
        // 캐시된 응답 사용
        botResponse = cachedResponse.answer;
        matchedId = cachedResponse.matchedId;
        source = 'cache';
      } else {
        // 기존 응답 생성 로직
        const result = await this.generateBotResponse(content);
        botResponse = result.response;
        matchedId = result.matchedId;
        source = result.source;

        // 3. 응답을 Redis에 캐싱 (개인정보가 없고 에러가 아닌 경우)
        if (personalData.length === 0 && source !== 'error') {
          try {
            await redis.setex(`chat:${this.generateCacheKey(content)}`, 3600, JSON.stringify({
              answer: botResponse,
              matchedId,
              source,
              timestamp: new Date()
            }));
            console.log('💾 캐시 저장 완료');
          } catch (cacheError) {
            console.error('Redis 캐싱 오류:', cacheError);
          }
        }
      }

      const responseTime = Date.now() - startTime;
      console.log('Bot response generated:', { 
        source, 
        matchedId, 
        responseTime,
        cached: !!cachedResponse,
        hasPersonalData: personalData.length > 0
      });

      // 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse
      });

      // 채팅방 업데이트
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse);

      // 분석 로그 저장 (개인정보 플래그 추가)
      await knowledgeDao.logChatAnalytics(
        content.trim(),
        botResponse,
        matchedId,
        responseTime,
        source,
        personalData.length > 0 // 개인정보 포함 여부
      );

      // 학습 큐에 추가
      this.addToLearningQueue({
        chat_analytics_id: null, // 실제 구현에서는 위의 logChatAnalytics에서 반환된 ID 사용
        user_message: content.trim(),
        bot_response: botResponse,
        response_source: source,
        confidence_score: source === 'pinecone' ? 0.9 : source === 'chatgpt' ? 0.7 : 0.5,
        matched_knowledge_id: matchedId
      });

      // 응답
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseSource: source,
        cached: !!cachedResponse,
        personalDataDetected: personalData.length > 0
      });
    } catch (error) {
      console.error('Error sending message - Full error:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // Missing Implementation 1: AI Vector DB to RDBMS Sync
  async syncPineconeToRDBMS() {
    try {
      console.log('🔄 Starting Pinecone to RDBMS sync...');
      
      // Get high-performing knowledge from Pinecone
      const stats = await pineconeDao.getStats();
      console.log(`📊 Total vectors in Pinecone: ${stats.totalRecordCount || 0}`);
      
      const allKnowledge = await pineconeDao.getAllKnowledge('', 1000);
      let syncedCount = 0;
      
      for (const item of allKnowledge) {
        try {
          // Check if already exists in RDBMS
          const existing = await knowledgeDao.findByPineconeId(item.id);
          
          if (!existing && item.score > 0.8) {
            // Add high-quality Pinecone knowledge to local RDBMS
            await knowledgeDao.createFromPinecone({
              pinecone_id: item.id,
              question: item.question,
              answer: item.answer,
              keywords: item.keywords,
              category: item.category,
              priority: item.priority,
              source: 'pinecone_sync'
            });
            
            syncedCount++;
            console.log(`✅ Synced Pinecone knowledge ${item.id} to RDBMS`);
          }
        } catch (itemError) {
          console.error(`❌ Error syncing item ${item.id}:`, itemError);
        }
      }
      
      console.log(`🎉 Sync completed: ${syncedCount} items synced to RDBMS`);
      return syncedCount;
    } catch (error) {
      console.error('Error syncing Pinecone to RDBMS:', error);
      throw error;
    }
  }

  // Missing Implementation 4: Complete Learning Loop - Pinecone Performance Analysis
  async analyzePineconePerformance() {
    try {
      // Get usage statistics from chat analytics
      const usageStats = await knowledgeDao.getPineconeUsageStats();
      
      // Get feedback data
      const feedbackStats = await learningDao.getPineconeFeedbackStats();
      
      // Combine and analyze
      const performanceData = [];
      
      for (const usage of usageStats) {
        const feedback = feedbackStats.find(f => f.pinecone_id === usage.pinecone_id);
        
        performanceData.push({
          id: usage.pinecone_id,
          question: usage.question,
          answer: usage.answer,
          usageCount: usage.usage_count,
          userFeedbackScore: feedback ? feedback.avg_rating : 3.0,
          lastUsed: usage.last_used
        });
      }
      
      return performanceData;
    } catch (error) {
      console.error('Error analyzing Pinecone performance:', error);
      return [];
    }
  }

  // Missing Implementation 4: Update RDBMS from Pinecone Performance
  async updateRDBMSFromPineconePerformance() {
    try {
      console.log('📈 Updating RDBMS from Pinecone performance data...');
      
      // Get performance metrics from Pinecone
      const performanceData = await this.analyzePineconePerformance();
      let updatedCount = 0;
      
      for (const item of performanceData) {
        if (item.userFeedbackScore > 4.0 && item.usageCount > 10) {
          try {
            // Update RDBMS with high-performing Pinecone answers
            await knowledgeDao.upsertFromPinecone({
              pinecone_id: item.id,
              question: item.question,
              answer: item.answer,
              performance_score: item.userFeedbackScore,
              usage_count: item.usageCount,
              last_updated: new Date()
            });
            
            updatedCount++;
            console.log(`✅ Updated RDBMS with high-performing Pinecone item: ${item.id}`);
          } catch (itemError) {
            console.error(`❌ Error updating item ${item.id}:`, itemError);
          }
        }
      }
      
      console.log(`🎉 Performance update completed: ${updatedCount} items updated in RDBMS`);
      return updatedCount;
    } catch (error) {
      console.error('Error updating RDBMS from Pinecone performance:', error);
      throw error;
    }
  }

  // 피드백 처리 메서드 추가
  async handleMessageFeedback(req, res) {
    try {
      const { id } = req.params;
      const { rating, helpful } = req.body;
      const userId = req.userId;

      // 피드백 저장
      await messageDao.saveFeedback(id, userId, rating, helpful);

      // 높은 평가를 받은 응답 우선순위 상향
      if (rating >= 4) {
        const message = await messageDao.getMessageById(id);
        if (message.pinecone_id) {
          await pineconeDao.updateKnowledge(message.pinecone_id, {
            priority: (message.priority || 5) + 1,
            metadata: {
              avgRating: rating,
              feedbackCount: (message.feedbackCount || 0) + 1
            }
          });
        }
      }

      res.json({ message: 'Feedback saved successfully' });
    } catch (error) {
      console.error('Error saving feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // 학습 큐에 추가하는 비동기 메서드
  async addToLearningQueue(data) {
    try {
      // 우선순위 계산
      let priority = 5;
      
      // ChatGPT 응답인 경우 우선순위 높임
      if (data.response_source === 'chatgpt') {
        priority = 7;
      }
      
      // 신뢰도가 낮은 경우 우선순위 높임
      if (data.confidence_score < 0.6) {
        priority = 8;
      }

      await learningDao.addToLearningQueue({
        ...data,
        priority
      });
    } catch (error) {
      console.error('Error adding to learning queue:', error);
    }
  }

  // 사용자 피드백 처리 메서드
  async handleUserFeedback(req, res) {
    try {
      const { messageId, feedbackType, feedbackText } = req.body;
      const userId = req.userId; // authMiddleware에서 설정

      if (!messageId || !feedbackType) {
        return res.status(400).json({ error: 'messageId and feedbackType are required' });
      }

      // 피드백 저장
      await learningDao.saveUserFeedback(messageId, userId, feedbackType, feedbackText);

      // 부정적 피드백인 경우 학습 큐 우선순위 높임
      if (feedbackType === 'not_helpful') {
        // 메시지 정보 조회
        const message = await messageDao.getMessageById(messageId);
        if (message && message.role === 'bot') {
          // 관련 학습 큐 항목의 우선순위 업데이트
          await learningDao.updateLearningPriority(messageId, 9);
        }
      }

      res.json({ message: 'Feedback recorded successfully' });
    } catch (error) {
      console.error('Error handling feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // 세션 종료 시 분석 메서드
  async analyzeSession(req, res) {
    try {
      const { sessionStart, sessionEnd } = req.body;
      const userId = req.userId;

      // 세션 분석 데이터 수집
      const sessionData = await learningDao.getSessionAnalytics(userId, sessionStart);
      
      // 세션 품질 평가
      const sessionQuality = this.evaluateSessionQuality(sessionData);
      
      // 낮은 품질의 세션인 경우 학습 필요
      if (sessionQuality < 0.6) {
        // 해당 세션의 모든 대화를 학습 큐에 추가
        await this.queueSessionForLearning(userId, sessionStart, sessionEnd);
      }

      res.json({ 
        message: 'Session analyzed',
        quality: sessionQuality,
        metrics: sessionData
      });
    } catch (error) {
      console.error('Error analyzing session:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // 세션 품질 평가
  evaluateSessionQuality(sessionData) {
    let score = 0.5;
    
    // DB 답변 비율이 높을수록 좋음
    const dbAnswerRatio = sessionData.db_answers / (sessionData.db_answers + sessionData.ai_answers);
    score += dbAnswerRatio * 0.3;
    
    // 응답 시간이 빠를수록 좋음
    if (sessionData.avg_response_time < 1000) {
      score += 0.2;
    }
    
    // 메시지가 적당히 많을수록 좋음 (사용자가 만족해서 계속 사용)
    if (sessionData.message_count > 5 && sessionData.message_count < 50) {
      score += 0.2;
    }
    
    return Math.min(1, score);
  }

  // 세션 학습 큐에 추가
  async queueSessionForLearning(userId, sessionStart, sessionEnd) {
    // 해당 세션의 모든 대화 내역 조회
    const messages = await messageDao.getSessionMessages(userId, sessionStart, sessionEnd);
    
    // 각 대화 쌍을 학습 큐에 추가
    for (let i = 0; i < messages.length - 1; i += 2) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'bot') {
        await learningDao.addToLearningQueue({
          user_message: messages[i].content,
          bot_response: messages[i + 1].content,
          response_source: 'session_analysis',
          priority: 6
        });
      }
    }
  }

  // 통합 AI 응답 생성 (Pinecone 우선, RDBMS 폴백)
  async generateBotResponse(userMessage) {
    try {
      console.log('🤖 Generating response for:', userMessage);

      // 1. Pinecone 벡터 DB에서 검색 (높은 정확도)
      try {
        const pineconeResult = await pineconeDao.searchAnswer(userMessage);
        if (pineconeResult && pineconeResult.score >= 0.8) {
          console.log('✅ High confidence match found in Pinecone');
          return {
            response: pineconeResult.answer,
            matchedId: pineconeResult.id,
            source: 'pinecone'
          };
        } else if (pineconeResult && pineconeResult.score >= 0.7) {
          console.log('⚠️ Medium confidence match in Pinecone, will try local DB too');
        }
      } catch (pineconeError) {
        console.error('Pinecone search error:', pineconeError);
      }

      // 2. 로컬 RDBMS에서 검색 (키워드 기반)
      const dbResult = await this.generateBotResponseFromDB(userMessage);
      if (dbResult.matchedId) {
        console.log('✅ Match found in local RDBMS');
        return {
          response: dbResult.response,
          matchedId: dbResult.matchedId,
          source: 'localdb'
        };
      }

      // 3. ChatGPT 호출 (최후 수단)
      try {
        console.log('📡 Calling ChatGPT API...');
        const gptResponse = await askChatGPT(userMessage);
        
        // ChatGPT 응답을 Pinecone에 자동 저장 (백그라운드)
        this.saveGPTResponseToPinecone(userMessage, gptResponse);
        
        return {
          response: gptResponse,
          matchedId: null,
          source: 'chatgpt'
        };
      } catch (gptError) {
        console.error('ChatGPT API error:', gptError);
      }

      // 4. 모두 실패 시 기본 응답
      console.log('📝 Using default response');
      return {
        response: this.getDefaultResponse(userMessage),
        matchedId: null,
        source: 'default'
      };

    } catch (error) {
      console.error('Error generating bot response:', error);
      return {
        response: '죄송합니다. 일시적인 오류가 발생했습니다. 다시 시도해 주세요.',
        matchedId: null,
        source: 'error'
      };
    }
  }

  // ChatGPT 응답을 Pinecone에 저장 (비동기)
  async saveGPTResponseToPinecone(question, answer) {
    try {
      // 비동기로 실행하여 응답 속도에 영향을 주지 않도록 함
      setImmediate(async () => {
        await pineconeDao.addKnowledge({
          question,
          answer,
          keywords: this.extractKeywords(question),
          category: 'chatgpt-generated',
          priority: 5,
          metadata: {
            source: 'chatgpt',
            autoGenerated: true
          }
        });
        console.log('💾 GPT response saved to Pinecone');
      });
    } catch (error) {
      console.error('Error saving GPT response to Pinecone:', error);
    }
  }

  // 간단한 키워드 추출 함수
  extractKeywords(text) {
    // 간단한 구현 - 실제로는 더 정교한 NLP 처리 필요
    const stopWords = ['은', '는', '이', '가', '을', '를', '에', '에서', '으로', '와', '과'];
    const words = text.split(/\s+/)
      .filter(word => word.length > 1)
      .filter(word => !stopWords.includes(word));
    return words.slice(0, 5).join(', ');
  }

  // RDBMS 기반 AI 응답 생성 (기존 코드 유지)
  async generateBotResponseFromDB(userMessage) {
    try {
      console.log('Searching in local RDBMS for:', userMessage);

      // 1. 먼저 정확한 질문 매칭 시도
      const exactMatch = await knowledgeDao.getExactAnswer(userMessage);
      if (exactMatch) {
        console.log('Exact match found in local DB:', exactMatch.id);
        return {
          response: exactMatch.answer,
          matchedId: exactMatch.id
        };
      }

      // 2. 키워드 기반 검색
      const keywordResults = await knowledgeDao.searchByKeywords(userMessage);
      if (keywordResults.length > 0) {
        console.log('Keyword match found in local DB:', keywordResults[0].id);
        return {
          response: keywordResults[0].answer,
          matchedId: keywordResults[0].id
        };
      }

      // 3. 단어별 매칭 검색
      const wordResults = await knowledgeDao.searchByWords(userMessage);
      if (wordResults.length > 0) {
        console.log('Word match found in local DB:', wordResults[0].id);
        return {
          response: wordResults[0].answer,
          matchedId: wordResults[0].id
        };
      }

      // 매칭 실패
      return {
        response: null,
        matchedId: null
      };

    } catch (error) {
      console.error('Error generating bot response from RDBMS:', error);
      return {
        response: null,
        matchedId: null
      };
    }
  }

  // 기본 응답 생성 (DB에 매칭되는 답변이 없을 때)
  getDefaultResponse(userMessage) {
    const defaultResponses = [
      `"${userMessage}"에 대한 정보를 찾을 수 없습니다. 다른 질문을 해주시거나, 다음과 같은 주제로 물어봐 주세요:\n\n• schedule\n• password\n• what I thought yesterday\n• Note\n• Life\n• Doctor appointment`,
      `죄송합니다. "${userMessage}"에 대한 답변을 준비하지 못했습니다. `,
      `입력하신 "${userMessage}"에 대한 정보를 찾지 못했습니다. 좀 더 구체적으로 질문해 주시거나, '도움'이라고 입력하시면 제가 답변할 수 있는 주제들을 안내해 드리겠습니다.`
    ];

    return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
  }

  // 메시지 삭제
  async deleteMessage(req, res) {
    try {
      const affectedRows = await messageDao.deleteMessage(req.params.id);
      
      if (affectedRows === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      res.json({ message: 'Message deleted successfully' });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // 카테고리별 도움말 제공
  async getHelp(req, res) {
    try {
      const categories = await knowledgeDao.getAllCategories();
      
      let helpMessage = "Your personal Secretary is in ready!:\n\n";
      
      categories.forEach(category => {
        helpMessage += `• **${category.name}**: ${category.description}\n`;
      });
      
      helpMessage += "\n궁금한 주제에 대해 자유롭게 질문해 주세요!";
      
      res.json({ message: helpMessage, categories });
    } catch (error) {
      console.error('Error getting help:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new MessageController();