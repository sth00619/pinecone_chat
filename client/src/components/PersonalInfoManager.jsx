// client/src/components/PersonalInfoManager.jsx
import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Heart, Target, MapPin, Phone, Trash2, Plus, RefreshCw } from 'lucide-react';

const PersonalInfoManager = ({ userId }) => {
  const [personalInfo, setPersonalInfo] = useState({
    schedules: [],
    birthdays: [],
    preferences: [],
    goals: [],
    locations: [],
    contacts: []
  });
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInfo, setNewInfo] = useState({
    type: 'schedule',
    value: '',
    key: '',
    datetime: ''
  });

  // API 호출 함수
  const apiCall = async (url, options = {}) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:3000/api'}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error('API request failed');
    }
    
    return response.json();
  };

  // 개인정보 로드
  const loadPersonalInfo = async () => {
    try {
      setLoading(true);
      const data = await apiCall('/messages/personal-info');
      
      // 데이터를 타입별로 분류
      const categorized = {
        schedules: [],
        birthdays: [],
        preferences: [],
        goals: [],
        locations: [],
        contacts: []
      };

      data.personalInfo.forEach(item => {
        switch (item.type) {
          case 'schedule':
            categorized.schedules.push(item);
            break;
          case 'birthday':
            categorized.birthdays.push(item);
            break;
          case 'preference':
            categorized.preferences.push(item);
            break;
          case 'goal':
            categorized.goals.push(item);
            break;
          case 'location':
            categorized.locations.push(item);
            break;
          case 'contact':
            categorized.contacts.push(item);
            break;
        }
      });

      setPersonalInfo(categorized);
    } catch (error) {
      console.error('Error loading personal info:', error);
    } finally {
      setLoading(false);
    }
  };

  // 리마인더 로드
  const loadReminders = async () => {
    try {
      const data = await apiCall('/messages/reminders');
      setReminders(data.reminders);
    } catch (error) {
      console.error('Error loading reminders:', error);
    }
  };

  // 개인정보 추가
  const handleAddInfo = async () => {
    try {
      await apiCall('/messages/personal-info', {
        method: 'POST',
        body: JSON.stringify(newInfo)
      });
      setShowAddForm(false);
      setNewInfo({ type: 'schedule', value: '', key: '', datetime: '' });
      await loadPersonalInfo();
    } catch (error) {
      console.error('Error adding personal info:', error);
    }
  };

  // 개인정보 삭제
  const handleDeleteInfo = async (id) => {
    if (window.confirm('정말로 이 정보를 삭제하시겠습니까?')) {
      try {
        await apiCall(`/messages/personal-info/${id}`, {
          method: 'DELETE'
        });
        await loadPersonalInfo();
      } catch (error) {
        console.error('Error deleting personal info:', error);
      }
    }
  };

  // 데이터 새로고침
  const handleRefresh = () => {
    loadPersonalInfo();
    loadReminders();
  };

  useEffect(() => {
    loadPersonalInfo();
    loadReminders();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">내 개인정보</h2>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-600 hover:text-blue-600 transition"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            추가
          </button>
        </div>
      </div>

      {/* 리마인더 섹션 */}
      {reminders.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold text-yellow-800 mb-2">🔔 리마인더</h3>
          <div className="space-y-2">
            {reminders.map((reminder, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{reminder.content}</span>
                <span className={`text-xs px-2 py-1 rounded ${
                  reminder.urgency === 'high' ? 'bg-red-100 text-red-600' :
                  reminder.urgency === 'medium' ? 'bg-yellow-100 text-yellow-600' :
                  'bg-green-100 text-green-600'
                }`}>
                  {reminder.urgency === 'high' ? '긴급' :
                   reminder.urgency === 'medium' ? '중요' : '일반'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 개인정보 추가 폼 */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                정보 유형
              </label>
              <select
                value={newInfo.type}
                onChange={(e) => setNewInfo({ ...newInfo, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="schedule">일정</option>
                <option value="birthday">생일/기념일</option>
                <option value="preference">선호도</option>
                <option value="goal">목표</option>
                <option value="location">위치</option>
                <option value="contact">연락처</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                키워드
              </label>
              <input
                type="text"
                value={newInfo.key}
                onChange={(e) => setNewInfo({ ...newInfo, key: e.target.value })}
                placeholder="예: 회의, 생일"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              내용
            </label>
            <textarea
              value={newInfo.value}
              onChange={(e) => setNewInfo({ ...newInfo, value: e.target.value })}
              required
              rows="2"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="정보를 입력하세요..."
            />
          </div>
          {(newInfo.type === 'schedule' || newInfo.type === 'birthday') && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                날짜/시간
              </label>
              <input
                type="text"
                value={newInfo.datetime}
                onChange={(e) => setNewInfo({ ...newInfo, datetime: e.target.value })}
                placeholder="예: 다음주 월요일 오후 2시"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAddInfo}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition"
            >
              저장
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 개인정보 목록 */}
      <div className="space-y-6">
        {/* 일정 */}
        {personalInfo.schedules.length > 0 && (
          <InfoSection
            title="일정"
            icon={<Calendar className="w-5 h-5" />}
            items={personalInfo.schedules}
            onDelete={handleDeleteInfo}
          />
        )}

        {/* 생일/기념일 */}
        {personalInfo.birthdays.length > 0 && (
          <InfoSection
            title="생일/기념일"
            icon={<Heart className="w-5 h-5" />}
            items={personalInfo.birthdays}
            onDelete={handleDeleteInfo}
          />
        )}

        {/* 선호도 */}
        {personalInfo.preferences.length > 0 && (
          <InfoSection
            title="선호도"
            icon={<Heart className="w-5 h-5" />}
            items={personalInfo.preferences.map(p => ({ id: p.id, value: p.value || p }))}
            onDelete={handleDeleteInfo}
          />
        )}

        {/* 목표 */}
        {personalInfo.goals.length > 0 && (
          <InfoSection
            title="목표"
            icon={<Target className="w-5 h-5" />}
            items={personalInfo.goals.map(g => ({ id: g.id, value: g.value || g }))}
            onDelete={handleDeleteInfo}
          />
        )}

        {/* 위치 */}
        {personalInfo.locations.length > 0 && (
          <InfoSection
            title="위치"
            icon={<MapPin className="w-5 h-5" />}
            items={personalInfo.locations}
            onDelete={handleDeleteInfo}
          />
        )}

        {/* 연락처 */}
        {personalInfo.contacts.length > 0 && (
          <InfoSection
            title="연락처"
            icon={<Phone className="w-5 h-5" />}
            items={personalInfo.contacts}
            onDelete={handleDeleteInfo}
          />
        )}
      </div>

      {/* 데이터가 없을 때 */}
      {Object.values(personalInfo).every(arr => arr.length === 0) && (
        <div className="text-center py-8 text-gray-500">
          저장된 개인정보가 없습니다. 대화 중에 자동으로 감지되거나 직접 추가할 수 있습니다.
        </div>
      )}
    </div>
  );
};

// 정보 섹션 컴포넌트
const InfoSection = ({ title, icon, items, onDelete }) => {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-700 mb-3">
        {icon}
        {title}
      </h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
          >
            <div className="flex-1">
              <p className="text-gray-800">{item.value}</p>
              {item.datetime && (
                <p className="text-sm text-gray-500 mt-1">
                  <Clock className="inline w-4 h-4 mr-1" />
                  {item.datetime}
                </p>
              )}
              {item.key && (
                <span className="inline-block mt-1 px-2 py-1 text-xs bg-blue-100 text-blue-600 rounded">
                  {item.key}
                </span>
              )}
            </div>
            <button
              onClick={() => onDelete(item.id)}
              className="ml-4 p-2 text-red-500 hover:bg-red-50 rounded transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PersonalInfoManager;