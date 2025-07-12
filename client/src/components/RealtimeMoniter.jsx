import React, { useState, useEffect, useRef } from 'react';
import { Activity, Database, Search, Plus, RefreshCw } from 'lucide-react';

const RealtimeMonitor = () => {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ totalVectors: 0, timestamp: '' });
  const [updates, setUpdates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  
  const socketRef = useRef(null);
  const updatesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    // WebSocket 연결
    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const connectWebSocket = () => {
    try {
      socketRef.current = new WebSocket('ws://localhost:3000');

      socketRef.current.onopen = () => {
        console.log('Connected to WebSocket');
        setConnected(true);
        // 연결 시 초기 데이터 요청
        sendMessage('requestStats', {});
      };

      socketRef.current.onclose = () => {
        console.log('Disconnected from WebSocket');
        setConnected(false);
        // 3초 후 재연결 시도
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      socketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      socketRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setConnected(false);
    }
  };

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'statsUpdate':
        setStats(data.data);
        break;
      
      case 'dataUpdated':
        setUpdates(prev => [...prev, {
          ...data.data,
          id: Date.now()
        }].slice(-10)); // 최근 10개만 유지
        break;
      
      case 'searchProgress':
        console.log('Search progress:', data.data);
        break;
      
      case 'searchResult':
        setSearchResult(data.data);
        setSearching(false);
        break;
      
      case 'searchError':
        console.error('Search error:', data.data);
        setSearching(false);
        break;
      
      case 'knowledgeAdded':
        if (data.data.success) {
          alert('지식이 성공적으로 추가되었습니다!');
        }
        break;
      
      case 'knowledgeError':
        alert(`오류: ${data.data.error}`);
        break;
    }
  };

  const sendMessage = (type, data) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, data }));
    }
  };

  useEffect(() => {
    // 업데이트 목록이 변경될 때 스크롤
    updatesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [updates]);

  const handleSearch = () => {
    if (!searchQuery.trim() || !connected) return;
    
    setSearching(true);
    setSearchResult(null);
    
    sendMessage('search', {
      query: searchQuery,
      sessionId: Date.now().toString()
    });
  };

  const refreshStats = () => {
    if (connected) {
      sendMessage('refreshStats', {});
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('ko-KR');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">실시간 Pinecone 모니터링</h1>
        
        {/* 연결 상태 */}
        <div className="mb-6 flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {connected ? 'WebSocket 연결됨' : 'WebSocket 연결 끊김'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 통계 카드 */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Pinecone 통계</h2>
              <button
                onClick={refreshStats}
                className="p-2 hover:bg-gray-100 rounded-md"
                disabled={!connected}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                <span className="text-2xl font-bold">{stats.totalVectors}</span>
                <span className="text-sm text-gray-500">벡터</span>
              </div>
              {stats.timestamp && (
                <p className="text-xs text-gray-500">
                  업데이트: {formatTimestamp(stats.timestamp)}
                </p>
              )}
            </div>
          </div>

          {/* 실시간 검색 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">실시간 검색</h2>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="질문을 입력하세요..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  disabled={!connected}
                />
                <button
                  onClick={handleSearch}
                  disabled={!connected || searching}
                  className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
              
              {searching && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                  검색 중...
                </div>
              )}
              
              {searchResult && (
                <div className={`p-3 rounded-md text-sm ${
                  searchResult.success ? 'bg-green-50' : 'bg-yellow-50'
                }`}>
                  {searchResult.success ? (
                    <>
                      <p className="font-medium mb-1">
                        신뢰도: {(searchResult.result.score * 100).toFixed(1)}%
                      </p>
                      <p className="text-gray-700">
                        {searchResult.result.answer.substring(0, 100)}...
                      </p>
                    </>
                  ) : (
                    <p className="text-gray-600">{searchResult.message}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 실시간 업데이트 로그 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              실시간 업데이트
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {updates.length === 0 ? (
                <p className="text-sm text-gray-500">아직 업데이트가 없습니다.</p>
              ) : (
                updates.map((update) => (
                  <div
                    key={update.id}
                    className="p-2 bg-gray-50 rounded text-sm flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      {update.type === 'add' ? (
                        <Plus className="h-3 w-3 text-green-600" />
                      ) : (
                        <RefreshCw className="h-3 w-3 text-blue-600" />
                      )}
                      {update.type === 'add' ? '추가' : '업데이트'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(update.timestamp)}
                    </span>
                  </div>
                ))
              )}
              <div ref={updatesEndRef} />
            </div>
          </div>
        </div>

        {/* 수동 데이터 추가 폼 */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">수동 데이터 추가</h2>
          <ManualDataForm connected={connected} sendMessage={sendMessage} />
        </div>
      </div>
    </div>
  );
};

// 수동 데이터 추가 폼 컴포넌트
const ManualDataForm = ({ connected, sendMessage }) => {
  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    keywords: '',
    category: 'general',
    priority: 5
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!connected) return;
    
    setSubmitting(true);
    
    sendMessage('addKnowledge', formData);
    
    // 2초 후 자동으로 submitting 상태 해제
    setTimeout(() => {
      setSubmitting(false);
      // 폼 초기화
      setFormData({
        question: '',
        answer: '',
        keywords: '',
        category: 'general',
        priority: 5
      });
    }, 2000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">질문</label>
        <input
          type="text"
          value={formData.question}
          onChange={(e) => setFormData({...formData, question: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!connected}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">키워드</label>
        <input
          type="text"
          value={formData.keywords}
          onChange={(e) => setFormData({...formData, keywords: e.target.value})}
          placeholder="쉼표로 구분"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!connected}
        />
      </div>
      
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 mb-1">답변</label>
        <textarea
          value={formData.answer}
          onChange={(e) => setFormData({...formData, answer: e.target.value})}
          rows="3"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!connected}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
        <select
          value={formData.category}
          onChange={(e) => setFormData({...formData, category: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!connected}
        >
          <option value="general">일반</option>
          <option value="학교소개">학교소개</option>
          <option value="입학">입학</option>
          <option value="학사">학사</option>
          <option value="캠퍼스생활">캠퍼스생활</option>
          <option value="취업진로">취업진로</option>
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">우선순위</label>
        <input
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value)})}
          min="0"
          max="10"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!connected}
        />
      </div>
      
      <div className="md:col-span-2">
        <button
          onClick={handleSubmit}
          disabled={!connected || submitting || !formData.question || !formData.answer || !formData.keywords}
          className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? '추가 중...' : '지식 추가'}
        </button>
      </div>
    </div>
  );
};

export default RealtimeMonitor;