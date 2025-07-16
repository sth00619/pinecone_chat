// client/src/components/pages/ChatPage.js
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useChat } from '../../hooks/useChat';
import Layout from '../../common/Layout';
import Loading from '../../common/Loading';
import ErrorMessage from '../../common/ErrorMessage';
import Modal from '../../common/Modal';
import PersonalInfoManager from '../PersonalInfoManager';
import { 
  Send, 
  Menu, 
  MessageCircle, 
  Plus, 
  Search, 
  MoreVertical, 
  Trash2, 
  Edit3, 
  Clock,
  X,
  Download,
  Upload,
  Settings,
  Info,
  User
} from 'lucide-react';

const ChatPage = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { 
    chatRooms, 
    currentChatRoom, 
    messages, 
    loading, 
    error,
    loadChatRooms,
    createChatRoom,
    selectChatRoom,
    sendMessage,
    updateChatRoomTitle,
    deleteChatRoom,
    clearError
  } = useChat();

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [showPersonalInfo, setShowPersonalInfo] = useState(false);
  
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);

  // messages가 배열인지 확인하고 안전한 기본값 제공
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeChatRooms = Array.isArray(chatRooms) ? chatRooms : [];

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    
    if (user?.id) {
      loadChatRooms(user.id);
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    scrollToBottom();
  }, [safeMessages]); // safeMessages 사용

  useEffect(() => {
    // 컴포넌트가 마운트될 때 외부 클릭으로 설정 메뉴 닫기
    const handleClickOutside = (event) => {
      if (isSettingsOpen && !event.target.closest('.chat-header-right')) {
        setIsSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSettingsOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCreateChatRoom = async () => {
    if (!user?.id) return;
    
    try {
      const title = newChatTitle.trim() || '새로운 채팅';
      const newRoom = await createChatRoom(user.id, title);
      setNewChatTitle('');
      setIsNewChatModalOpen(false);
      await selectChatRoom(newRoom);
    } catch (error) {
      console.error('Failed to create chat room:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!messageInput.trim() || !currentChatRoom) return;
    
    try {
      await sendMessage(messageInput.trim());
      setMessageInput('');
      messageInputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleDeleteChatRoom = async (chatRoomId) => {
    if (window.confirm('정말로 이 채팅방을 삭제하시겠습니까?')) {
      try {
        await deleteChatRoom(chatRoomId);
      } catch (error) {
        console.error('Failed to delete chat room:', error);
      }
    }
  };

  const handleUpdateTitle = async (chatRoomId) => {
    if (newTitle.trim() && newTitle !== editingTitle) {
      try {
        await updateChatRoomTitle(chatRoomId, newTitle.trim());
        setEditingTitle(null);
        setNewTitle('');
      } catch (error) {
        console.error('Failed to update title:', error);
      }
    } else {
      // 수정 취소
      setEditingTitle(null);
      setNewTitle('');
    }
  };

  const handleKeyPressInTextarea = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const filteredChatRooms = safeChatRooms.filter(room => 
    room.title && room.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 디버깅을 위한 로그 (개발 환경에서만)
  if (process.env.NODE_ENV === 'development') {
    console.log('Messages type:', typeof messages, 'Is array:', Array.isArray(messages), 'Value:', messages);
    console.log('ChatRooms type:', typeof chatRooms, 'Is array:', Array.isArray(chatRooms), 'Value:', chatRooms);
  }

  return (
    <Layout showFooter={false}>
      <div className="chat-page">
        <div className="chat-room">
          {/* Sidebar */}
          <div className={`chat-sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
              <h3>채팅 목록</h3>
              <button 
                className="sidebar-close"
                onClick={() => setIsSidebarOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="sidebar-actions">
              <button 
                className="btn btn-primary btn-full-width"
                onClick={() => setIsNewChatModalOpen(true)}
              >
                <Plus size={16} />
                <span>새 채팅 시작</span>
              </button>
            </div>

            <div className="sidebar-search">
              <div className="search-input-group">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="채팅방 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
            </div>

            <div className="sidebar-content">
              {loading ? (
                <div className="chat-list-loading">
                  <Loading size="small" text="로딩 중..." />
                </div>
              ) : filteredChatRooms.length === 0 ? (
                <div className="chat-list-empty">
                  <MessageCircle size={48} className="empty-icon" />
                  <h4>채팅방이 없습니다</h4>
                  <p>새로운 채팅을 시작해보세요!</p>
                </div>
              ) : (
                <div className="chat-list">
                  {filteredChatRooms.map(room => (
                    <div
                      key={room.id}
                      className={`chat-list-item ${currentChatRoom?.id === room.id ? 'active' : ''}`}
                      onClick={() => selectChatRoom(room)}
                    >
                      <div className="chat-item-content">
                        <div className="chat-item-header">
                          <h4 className="chat-item-title">{room.title || '제목 없음'}</h4>
                          <span className="chat-item-time">
                            <Clock size={12} />
                            {room.updated_at ? new Date(room.updated_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                        {room.last_message && (
                          <p className="chat-item-preview">{room.last_message}</p>
                        )}
                      </div>
                      <MessageCircle size={16} className="chat-item-indicator" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Chat Area */}
          <div className={`chat-main ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <div className="chat-header">
              <div className="chat-header-left">
                <button 
                  className="sidebar-toggle"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                >
                  <Menu size={20} />
                </button>
                <div className="chat-title">
                  {currentChatRoom ? (
                    editingTitle === currentChatRoom.id ? (
                      <input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onBlur={() => handleUpdateTitle(currentChatRoom.id)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateTitle(currentChatRoom.id);
                          } else if (e.key === 'Escape') {
                            setEditingTitle(null);
                            setNewTitle('');
                          }
                        }}
                        className="form-input"
                        autoFocus
                        placeholder="채팅방 제목 입력"
                      />
                    ) : (
                      <>
                        <h3>{currentChatRoom.title || '제목 없음'}</h3>
                        <p className="chat-subtitle">AI 어시스턴트와 대화 중</p>
                      </>
                    )
                  ) : (
                    <h3>채팅방을 선택하세요</h3>
                  )}
                </div>
              </div>
              <div className="chat-header-right">
                {currentChatRoom && (
                  <>
                    <button
                      className="chat-settings"
                      onClick={() => setShowPersonalInfo(!showPersonalInfo)}
                      title="개인정보 관리"
                    >
                      <User size={20} />
                    </button>
                    <button 
                      className="chat-settings"
                      onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    >
                      <MoreVertical size={20} />
                    </button>
                    {isSettingsOpen && (
                      <div className="settings-dropdown">
                        <button 
                          className="dropdown-item"
                          onClick={() => {
                            setEditingTitle(currentChatRoom.id);
                            setNewTitle(currentChatRoom.title || '');
                            setIsSettingsOpen(false);
                          }}
                        >
                          <Edit3 size={16} />
                          제목 수정
                        </button>
                        <button className="dropdown-item disabled">
                          <Download size={16} />
                          대화 내보내기
                        </button>
                        <div className="dropdown-divider" />
                        <button 
                          className="dropdown-item danger"
                          onClick={() => {
                            handleDeleteChatRoom(currentChatRoom.id);
                            setIsSettingsOpen(false);
                          }}
                        >
                          <Trash2 size={16} />
                          채팅방 삭제
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="chat-content">
              {showPersonalInfo && user ? (
                <PersonalInfoManager userId={user.id} />
              ) : currentChatRoom ? (
                <div className="message-list">
                  {safeMessages.length === 0 ? (
                    <div className="message-list-empty">
                      <div className="empty-state">
                        <MessageCircle size={48} className="empty-icon" />
                        <h3>대화를 시작해보세요!</h3>
                        <p>궁금한 점이 있으시면 무엇이든 물어보세요.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="messages-container">
                      {safeMessages.map((message, index) => (
                        <div 
                          key={message.id || `message-${index}`} 
                          className={`message ${message.role === 'user' ? 'user-message' : 'bot-message'}`}
                        >
                          <div className={`message-avatar ${message.role === 'user' ? 'user-avatar' : 'bot-avatar'}`}>
                            {message.role === 'user' ? 
                              (user?.username?.charAt(0).toUpperCase() || 'U') : 
                              'AI'
                            }
                          </div>
                          <div className="message-content">
                            <div className="message-header">
                              <span className="message-sender">
                                {message.role === 'user' ? 
                                  (user?.username || '사용자') : 
                                  'AI Assistant'
                                }
                              </span>
                              <span className="message-time">
                                {message.created_at ? 
                                  new Date(message.created_at).toLocaleTimeString() : 
                                  new Date().toLocaleTimeString()
                                }
                              </span>
                            </div>
                            <div className="message-body">
                              <p>{message.content || ''}</p>
                              {message.hasPersonalContext && (
                                <div className="personal-context-indicator">
                                  💡 개인정보를 참고하여 답변했습니다
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}

                  {currentChatRoom && (
                    <div className="message-input-container">
                      <form onSubmit={handleSendMessage} className="message-input-form">
                        <div className="input-actions-left">
                          <button type="button" className="input-action-btn" disabled>
                            <Upload size={20} />
                          </button>
                        </div>
                        <div className="message-input-wrapper">
                          <textarea
                            ref={messageInputRef}
                            value={messageInput}
                            onChange={(e) => setMessageInput(e.target.value)}
                            onKeyPress={handleKeyPressInTextarea}
                            placeholder="메시지를 입력하세요..."
                            className="message-textarea"
                            rows="1"
                            disabled={loading}
                          />
                        </div>
                        <div className="input-actions-right">
                          <button 
                            type="submit" 
                            className="input-action-btn"
                            disabled={!messageInput.trim() || loading}
                          >
                            <Send size={20} />
                          </button>
                        </div>
                      </form>
                      <div className="input-help-text">
                        <span>Enter로 전송, Shift+Enter로 줄바꿈</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="chat-welcome">
                  <div className="welcome-content">
                    <div className="welcome-icon">🤖</div>
                    <h2>SeoulTech AI Assistant</h2>
                    <p>서울과학기술대학교에 대해 궁금한 점이 있으신가요?</p>
                    <p>채팅방을 선택하거나 새로운 대화를 시작해보세요!</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modals */}
        <Modal
          isOpen={isNewChatModalOpen}
          onClose={() => setIsNewChatModalOpen(false)}
          title="새 채팅 시작"
        >
          <form onSubmit={(e) => { e.preventDefault(); handleCreateChatRoom(); }} className="new-chat-form">
            <div className="form-group">
              <label className="form-label">채팅방 제목</label>
              <input
                type="text"
                value={newChatTitle}
                onChange={(e) => setNewChatTitle(e.target.value)}
                placeholder="예: 학과 정보 문의"
                className="form-input"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary">
                채팅 시작
              </button>
              <button 
                type="button" 
                className="btn btn-ghost"
                onClick={() => setIsNewChatModalOpen(false)}
              >
                취소
              </button>
            </div>
          </form>
        </Modal>

        {error && (
          <ErrorMessage 
            error={error} 
            onClose={clearError}
            type="error"
          />
        )}
      </div>
    </Layout>
  );
};

export default ChatPage;