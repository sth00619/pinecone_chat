import React, { useState, useEffect } from 'react';
import { Search, Upload, Database, RefreshCw, Trash2, Plus } from 'lucide-react';

const PineconeAdmin = () => {
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  
  // 새 지식 추가 폼
  const [newKnowledge, setNewKnowledge] = useState({
    question: '',
    answer: '',
    keywords: '',
    category: 'general',
    priority: 0
  });

  // API 기본 URL (환경에 따라 수정)
  const API_URL = window.REACT_APP_API_URL || 'http://localhost:3000/api';
  
  // 토큰 가져오기 (실제 구현에서는 Context나 Redux에서)
  const getToken = () => localStorage.getItem('token');

  // 통계 조회
  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_URL}/pinecone/stats`, {
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      setStats(data.stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // 검색
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/pinecone/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: searchQuery, topK: 5 })
      });
      const data = await response.json();
      setSearchResults(data.result);
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setLoading(false);
    }
  };

  // 모든 지식 조회
  const fetchAllKnowledge = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/pinecone/knowledge?limit=100`);
      const data = await response.json();
      setKnowledge(data.knowledge || []);
    } catch (error) {
      console.error('Error fetching knowledge:', error);
    } finally {
      setLoading(false);
    }
  };

  // 새 지식 추가
  const handleAddKnowledge = async () => {
    if (!newKnowledge.question || !newKnowledge.answer || !newKnowledge.keywords) {
      alert('질문, 답변, 키워드는 필수 입력 항목입니다.');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await fetch(`${API_URL}/pinecone/knowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(newKnowledge)
      });
      
      if (response.ok) {
        alert('지식이 성공적으로 추가되었습니다!');
        setNewKnowledge({
          question: '',
          answer: '',
          keywords: '',
          category: 'general',
          priority: 0
        });
        fetchAllKnowledge();
      }
    } catch (error) {
      console.error('Error adding knowledge:', error);
      alert('지식 추가 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 지식 삭제
  const handleDeleteKnowledge = async (id) => {
    if (!window.confirm('정말로 이 지식을 삭제하시겠습니까?')) return;
    
    try {
      const response = await fetch(`${API_URL}/pinecone/knowledge/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      });
      
      if (response.ok) {
        fetchAllKnowledge();
      }
    } catch (error) {
      console.error('Error deleting knowledge:', error);
    }
  };

  // 마이그레이션
  const handleMigrate = async () => {
    if (!window.confirm('로컬 DB의 모든 데이터를 Pinecone으로 마이그레이션하시겠습니까?')) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/pinecone/migrate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      alert(data.message);
      fetchStats();
      fetchAllKnowledge();
    } catch (error) {
      console.error('Error migrating:', error);
      alert('마이그레이션 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    if (activeTab === 'list') {
      fetchAllKnowledge();
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Pinecone 벡터 DB 관리</h1>
        
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">총 벡터 수</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {stats?.totalRecordCount || 0}
                </p>
              </div>
              <Database className="h-8 w-8 text-blue-500" />
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">인덱스 차원</p>
                <p className="text-2xl font-semibold text-gray-900">1536</p>
              </div>
              <RefreshCw className="h-8 w-8 text-green-500" />
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <button
              onClick={handleMigrate}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              DB 마이그레이션
            </button>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('search')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'search'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              검색 테스트
            </button>
            <button
              onClick={() => setActiveTab('add')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'add'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              지식 추가
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'list'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              지식 목록
            </button>
          </nav>
        </div>

        {/* 탭 컨텐츠 */}
        <div className="bg-white rounded-lg shadow p-6">
          {activeTab === 'search' && (
            <div className="space-y-6">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="검색할 질문을 입력하세요..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <Search className="h-4 w-4" />
                  검색
                </button>
              </div>
              
              {searchResults && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-lg mb-2">검색 결과</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600">신뢰도: {(searchResults.score * 100).toFixed(1)}%</p>
                    <p className="font-medium">{searchResults.question}</p>
                    <p className="text-gray-700">{searchResults.answer}</p>
                    <p className="text-sm text-gray-500">카테고리: {searchResults.category}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'add' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">질문</label>
                <input
                  type="text"
                  value={newKnowledge.question}
                  onChange={(e) => setNewKnowledge({...newKnowledge, question: e.target.value})}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">답변</label>
                <textarea
                  value={newKnowledge.answer}
                  onChange={(e) => setNewKnowledge({...newKnowledge, answer: e.target.value})}
                  required
                  rows="4"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">키워드 (쉼표로 구분)</label>
                <input
                  type="text"
                  value={newKnowledge.keywords}
                  onChange={(e) => setNewKnowledge({...newKnowledge, keywords: e.target.value})}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <select
                    value={newKnowledge.category}
                    onChange={(e) => setNewKnowledge({...newKnowledge, category: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="general">일반</option>
                    <option value="학교소개">학교소개</option>
                    <option value="입학">입학</option>
                    <option value="학사">학사</option>
                    <option value="취업">취업</option>
                    <option value="캠퍼스">캠퍼스</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">우선순위</label>
                  <input
                    type="number"
                    value={newKnowledge.priority}
                    onChange={(e) => setNewKnowledge({...newKnowledge, priority: parseInt(e.target.value)})}
                    min="0"
                    max="10"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              
              <button
                onClick={handleAddKnowledge}
                disabled={loading}
                className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                지식 추가
              </button>
            </div>
          )}

          {activeTab === 'list' && (
            <div>
              <h3 className="font-semibold text-lg mb-4">저장된 지식 목록</h3>
              {loading ? (
                <p className="text-center py-4">로딩 중...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">질문</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">카테고리</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">우선순위</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">작업</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {knowledge.map((item) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.question.substring(0, 50)}...
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {item.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {item.priority}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button
                              onClick={() => handleDeleteKnowledge(item.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PineconeAdmin;