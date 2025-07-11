const messageDao = require('../dao/messageDao');
const chatRoomDao = require('../dao/chatRoomDao');
const knowledgeDao = require('../dao/knowledgeDao');
const pineconeDao = require('../dao/pineconeDao');
const axios = require('axios');

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
            content: '당신은 서울과학기술대학교의 AI 도우미입니다. 학생들에게 학교 생활, 학업, 진로 등에 대해 친절하고 정확하게 답변해주세요.'
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

  // 새 메시지 전송 (사용자 메시지 + AI 응답)
  async sendMessage(req, res) {
    try {
      console.log('sendMessage called with:', req.body);
      const startTime = Date.now();
      const { chat_room_id, content } = req.body;

      // 입력 검증
      if (!chat_room_id || !content) {
        return res.status(400).json({ error: 'chat_room_id and content are required' });
      }

      // 채팅방 존재 확인
      const chatRoom = await chatRoomDao.getChatRoomById(chat_room_id);
      if (!chatRoom) {
        return res.status(404).json({ error: 'Chat room not found' });
      }

      // 사용자 메시지 저장
      const userMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'user',
        content: content.trim()
      });

      // AI 응답 생성 - 우선순위: Pinecone -> Local DB -> ChatGPT
      const messageController = new MessageController();
      const { response: botResponse, matchedId, source } = await messageController.generateBotResponse(content);
      const responseTime = Date.now() - startTime;
      
      console.log('Bot response generated:', { 
        source, 
        matchedId, 
        responseTime,
        preview: botResponse.substring(0, 100) + '...'
      });

      // 봇 메시지 저장
      const botMessageId = await messageDao.createMessage({
        chat_room_id,
        role: 'bot',
        content: botResponse
      });

      // 채팅방 업데이트 시간 갱신 및 마지막 메시지 설정
      await chatRoomDao.updateChatRoomLastMessage(chat_room_id, botResponse);

      // 채팅 분석 로그 저장 (source 정보 포함)
      await knowledgeDao.logChatAnalytics(
        content.trim(),
        botResponse,
        matchedId,
        responseTime,
        source // 추가 컬럼이 필요한 경우 DB 스키마 수정 필요
      );

      // 저장된 메시지들 조회해서 반환
      const userMessage = await messageDao.getMessageById(userMessageId);
      const botMessage = await messageDao.getMessageById(botMessageId);

      res.status(201).json({
        userMessage,
        botMessage,
        responseSource: source // 클라이언트에게 응답 출처 정보 제공
      });
    } catch (error) {
      console.error('Error sending message - Full error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // 통합 AI 응답 생성 (Pinecone 우선)
  async generateBotResponse(userMessage) {
    try {
      console.log('🤖 Generating response for:', userMessage);

      // 1. Pinecone 벡터 DB에서 검색
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
          // 중간 신뢰도의 경우 로컬 DB도 확인
        }
      } catch (pineconeError) {
        console.error('Pinecone search error:', pineconeError);
        // Pinecone 오류 시 계속 진행
      }

      // 2. 로컬 DB에서 검색 (기존 로직)
      const dbResult = await this.generateBotResponseFromDB(userMessage);
      if (dbResult.matchedId) {
        console.log('✅ Match found in local DB');
        return {
          response: dbResult.response,
          matchedId: dbResult.matchedId,
          source: 'localdb'
        };
      }

      // 3. 모두 실패 시 ChatGPT 호출
      console.log('📡 No match found, calling ChatGPT...');
      try {
        const gptResponse = await askChatGPT(userMessage);
        
        // ChatGPT 응답을 Pinecone에 저장 (학습 효과)
        this.saveGPTResponseToPinecone(userMessage, gptResponse);
        
        return {
          response: gptResponse,
          matchedId: null,
          source: 'chatgpt'
        };
      } catch (gptError) {
        console.error("❌ GPT 호출 실패:", gptError.message);
        return {
          response: this.getDefaultResponse(userMessage),
          matchedId: null,
          source: 'default'
        };
      }

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

  // DB 기반 AI 응답 생성 (기존 코드 유지)
  async generateBotResponseFromDB(userMessage) {
    try {
      console.log('Searching in local DB for:', userMessage);

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
      console.error('Error generating bot response from DB:', error);
      return {
        response: null,
        matchedId: null
      };
    }
  }

  // 기본 응답 생성 (DB에 매칭되는 답변이 없을 때)
  getDefaultResponse(userMessage) {
    const defaultResponses = [
      `"${userMessage}"에 대한 정보를 찾을 수 없습니다. 다른 질문을 해주시거나, 다음과 같은 주제로 물어봐 주세요:\n\n• 학교 소개\n• 전공/학과 정보\n• 입학 정보\n• 취업/진로\n• 캠퍼스 생활\n• 장학금`,
      `죄송합니다. "${userMessage}"에 대한 답변을 준비하지 못했습니다. 서울과학기술대학교에 대한 다른 궁금한 점이 있으시면 말씀해 주세요!`,
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
      
      let helpMessage = "서울과학기술대학교 AI 챗봇이 도와드릴 수 있는 주제들입니다:\n\n";
      
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