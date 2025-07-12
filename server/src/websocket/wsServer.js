const { Server } = require('socket.io');
const pineconeDao = require('../dao/pineconeDao');

class WebSocketServer {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3001",
        methods: ["GET", "POST"]
      }
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log('✅ Client connected:', socket.id);

      // 클라이언트 연결 시 현재 상태 전송
      this.sendCurrentStats(socket);

      // 실시간 검색 요청
      socket.on('search', async (data) => {
        await this.handleSearch(socket, data);
      });

      // 지식 추가 요청
      socket.on('addKnowledge', async (data) => {
        await this.handleAddKnowledge(socket, data);
      });

      // 지식 업데이트 요청
      socket.on('updateKnowledge', async (data) => {
        await this.handleUpdateKnowledge(socket, data);
      });

      // 통계 새로고침 요청
      socket.on('refreshStats', async () => {
        await this.sendCurrentStats(socket);
      });

      // 연결 해제
      socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
      });
    });
  }

  // 현재 통계 전송
  async sendCurrentStats(socket) {
    try {
      const stats = await pineconeDao.getStats();
      socket.emit('statsUpdate', {
        totalVectors: stats.totalRecordCount || 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error sending stats:', error);
    }
  }

  // 실시간 검색 처리
  async handleSearch(socket, data) {
    const { query, sessionId } = data;
    
    try {
      // 검색 시작 알림
      socket.emit('searchProgress', {
        sessionId,
        status: 'searching',
        message: 'Pinecone에서 검색 중...'
      });

      // Pinecone 검색
      const result = await pineconeDao.searchAnswer(query, 3);
      
      if (result && result.score >= 0.7) {
        socket.emit('searchResult', {
          sessionId,
          success: true,
          result: {
            answer: result.answer,
            score: result.score,
            category: result.category,
            source: 'pinecone'
          }
        });
      } else {
        // Pinecone에서 못 찾은 경우
        socket.emit('searchProgress', {
          sessionId,
          status: 'fallback',
          message: 'Pinecone에서 찾지 못함. ChatGPT로 전환...'
        });
        
        socket.emit('searchResult', {
          sessionId,
          success: false,
          message: 'Pinecone에서 적절한 답변을 찾지 못했습니다.'
        });
      }
    } catch (error) {
      console.error('Search error:', error);
      socket.emit('searchError', {
        sessionId,
        error: error.message
      });
    }
  }

  // 지식 추가 처리
  async handleAddKnowledge(socket, data) {
    try {
      const id = await pineconeDao.addKnowledge(data);
      
      // 성공 알림
      socket.emit('knowledgeAdded', {
        success: true,
        id,
        message: '지식이 성공적으로 추가되었습니다.'
      });
      
      // 모든 클라이언트에게 업데이트 알림
      this.io.emit('dataUpdated', {
        type: 'add',
        timestamp: new Date().toISOString()
      });
      
      // 통계 업데이트
      this.sendCurrentStats(this.io);
      
    } catch (error) {
      console.error('Add knowledge error:', error);
      socket.emit('knowledgeError', {
        error: error.message
      });
    }
  }

  // 지식 업데이트 처리
  async handleUpdateKnowledge(socket, data) {
    try {
      const { id, updateData } = data;
      await pineconeDao.updateKnowledge(id, updateData);
      
      // 성공 알림
      socket.emit('knowledgeUpdated', {
        success: true,
        id,
        message: '지식이 성공적으로 업데이트되었습니다.'
      });
      
      // 모든 클라이언트에게 업데이트 알림
      this.io.emit('dataUpdated', {
        type: 'update',
        id,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Update knowledge error:', error);
      socket.emit('knowledgeError', {
        error: error.message
      });
    }
  }

  // 외부에서 업데이트 알림을 보낼 수 있는 메서드
  notifyDataUpdate(type, data) {
    this.io.emit('dataUpdated', {
      type,
      data,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = WebSocketServer;