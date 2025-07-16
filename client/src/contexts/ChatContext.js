import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { chatService } from '../services/chatService';

const ChatContext = createContext();

const chatReducer = (state, action) => {
  // 안전한 배열 접근을 위한 헬퍼 함수
  const ensureArray = (value) => Array.isArray(value) ? value : [];
  
  // 현재 상태의 배열들이 유효한지 확인
  const safeChatRooms = ensureArray(state.chatRooms);
  const safeMessages = ensureArray(state.messages);
  
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
      
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
      
    case 'CLEAR_ERROR':
      return { ...state, error: null };
      
    case 'SET_CHAT_ROOMS':
      // action.payload가 배열인지 확인
      const newChatRooms = ensureArray(action.payload);
      return { ...state, chatRooms: newChatRooms };
      
    case 'ADD_CHAT_ROOM':
      // action.payload가 유효한 객체인지 확인
      if (!action.payload || typeof action.payload !== 'object') {
        console.warn('Invalid chat room payload:', action.payload);
        return state;
      }
      return { ...state, chatRooms: [action.payload, ...safeChatRooms] };
      
    case 'UPDATE_CHAT_ROOM':
      if (!action.payload || !action.payload.id) {
        console.warn('Invalid update chat room payload:', action.payload);
        return state;
      }
      return {
        ...state,
        chatRooms: safeChatRooms.map(room =>
          room && room.id === action.payload.id ? action.payload : room
        )
      };
      
    case 'DELETE_CHAT_ROOM':
      if (!action.payload) {
        console.warn('Invalid delete chat room payload:', action.payload);
        return state;
      }
      return {
        ...state,
        chatRooms: safeChatRooms.filter(room => room && room.id !== action.payload)
      };
      
    case 'SET_CURRENT_CHAT_ROOM':
      return { 
        ...state, 
        currentChatRoom: action.payload, 
        messages: [] // 새 채팅방 선택 시 메시지 초기화
      };
      
    case 'SET_MESSAGES':
      // action.payload가 배열인지 확인
      const newMessages = ensureArray(action.payload);
      return { ...state, messages: newMessages };
      
    case 'ADD_MESSAGE':
      // action.payload가 유효한 메시지 객체인지 확인
      if (!action.payload || typeof action.payload !== 'object') {
        console.warn('Invalid message payload:', action.payload);
        return state;
      }
      return { ...state, messages: [...safeMessages, action.payload] };
      
    case 'ADD_MESSAGES':
      // action.payload가 배열인지 확인
      const messagesToAdd = ensureArray(action.payload);
      return { ...state, messages: [...safeMessages, ...messagesToAdd] };
      
    case 'DELETE_MESSAGE':
      if (!action.payload) {
        console.warn('Invalid delete message payload:', action.payload);
        return state;
      }
      return {
        ...state,
        messages: safeMessages.filter(msg => msg && msg.id !== action.payload)
      };
      
    case 'RESET_STATE':
      return initialState;
      
    default:
      console.warn('Unknown action type:', action.type);
      return state;
  }
};

const initialState = {
  chatRooms: [],
  currentChatRoom: null,
  messages: [],
  loading: false,
  error: null
};

export const ChatProvider = ({ children }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // 상태 안전성 보장
  const safeState = {
    ...state,
    chatRooms: Array.isArray(state.chatRooms) ? state.chatRooms : [],
    messages: Array.isArray(state.messages) ? state.messages : []
  };

  const handleError = useCallback((error, defaultMessage) => {
    console.error('Chat error:', error);
    const message = error?.response?.data?.error || error?.message || defaultMessage;
    dispatch({ type: 'SET_ERROR', payload: message });
  }, []);

  // 채팅방 관련 액션들
  const loadChatRooms = useCallback(async (userId) => {
    if (!userId) {
      console.warn('loadChatRooms: userId is required');
      return;
    }
    
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'CLEAR_ERROR' });
      
      const chatRooms = await chatService.getChatRooms(userId);
      dispatch({ type: 'SET_CHAT_ROOMS', payload: chatRooms });
    } catch (error) {
      handleError(error, '채팅방 목록을 불러오는데 실패했습니다.');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [handleError]);

  const createChatRoom = useCallback(async (userId, title) => {
    if (!userId) {
      handleError(new Error('로그인이 필요합니다.'), '로그인이 필요합니다.');
      return null;
    }
    
    if (!title || typeof title !== 'string' || title.trim() === '') {
      handleError(new Error('채팅방 제목이 필요합니다.'), '채팅방 제목이 필요합니다.');
      return null;
    }
    
    try {
      dispatch({ type: 'CLEAR_ERROR' });
      const newChatRoom = await chatService.createChatRoom(userId, title.trim());
      
      if (newChatRoom && typeof newChatRoom === 'object') {
        dispatch({ type: 'ADD_CHAT_ROOM', payload: newChatRoom });
        return newChatRoom;
      } else {
        throw new Error('Invalid chat room response');
      }
    } catch (error) {
      handleError(error, '채팅방 생성에 실패했습니다.');
      throw error;
    }
  }, [handleError]);

  const updateChatRoomTitle = useCallback(async (chatRoomId, title) => {
    if (!chatRoomId) {
      handleError(new Error('채팅방 ID가 필요합니다.'), '채팅방 ID가 필요합니다.');
      return;
    }
    
    if (!title || typeof title !== 'string' || title.trim() === '') {
      handleError(new Error('채팅방 제목이 필요합니다.'), '채팅방 제목이 필요합니다.');
      return;
    }
    
    try {
      dispatch({ type: 'CLEAR_ERROR' });
      await chatService.updateChatRoomTitle(chatRoomId, title.trim());
      
      const updatedRoom = { ...safeState.currentChatRoom, title: title.trim() };
      dispatch({ type: 'UPDATE_CHAT_ROOM', payload: updatedRoom });
      
      if (safeState.currentChatRoom?.id === chatRoomId) {
        dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: updatedRoom });
      }
    } catch (error) {
      handleError(error, '채팅방 제목 변경에 실패했습니다.');
    }
  }, [safeState.currentChatRoom, handleError]);

  const deleteChatRoom = useCallback(async (chatRoomId) => {
    if (!chatRoomId) {
      handleError(new Error('채팅방 ID가 필요합니다.'), '채팅방 ID가 필요합니다.');
      return;
    }
    
    try {
      dispatch({ type: 'CLEAR_ERROR' });
      await chatService.deleteChatRoom(chatRoomId);
      dispatch({ type: 'DELETE_CHAT_ROOM', payload: chatRoomId });
      
      if (safeState.currentChatRoom?.id === chatRoomId) {
        dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: null });
      }
    } catch (error) {
      handleError(error, '채팅방 삭제에 실패했습니다.');
    }
  }, [safeState.currentChatRoom, handleError]);

  const selectChatRoom = useCallback(async (chatRoom) => {
    if (!chatRoom || !chatRoom.id) {
      handleError(new Error('유효하지 않은 채팅방입니다.'), '유효하지 않은 채팅방입니다.');
      return;
    }
    
    try {
      dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: chatRoom });
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'CLEAR_ERROR' });
      
      const messages = await chatService.getMessages(chatRoom.id);
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    } catch (error) {
      handleError(error, '메시지를 불러오는데 실패했습니다.');
      // 오류 발생 시 빈 메시지 배열로 설정
      dispatch({ type: 'SET_MESSAGES', payload: [] });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [handleError]);

  // 메시지 관련 액션들
  const sendMessage = useCallback(async (content) => {
    if (!safeState.currentChatRoom) {
      handleError(new Error('채팅방을 선택해주세요.'), '채팅방을 선택해주세요.');
      return null;
    }

    if (!content || typeof content !== 'string' || content.trim() === '') {
      handleError(new Error('메시지 내용이 필요합니다.'), '메시지 내용이 필요합니다.');
      return null;
    }

    try {
      dispatch({ type: 'CLEAR_ERROR' });
      const response = await chatService.sendMessage(safeState.currentChatRoom.id, content.trim());
      
      // 응답 유효성 검사
      if (response && response.userMessage && response.botMessage) {
        dispatch({ type: 'ADD_MESSAGE', payload: response.userMessage });
        dispatch({ type: 'ADD_MESSAGE', payload: response.botMessage });
        
        // 채팅방 목록의 마지막 메시지 업데이트
        if (response.botMessage.content) {
          const updatedRoom = {
            ...safeState.currentChatRoom,
            last_message: response.botMessage.content.substring(0, 50) + (response.botMessage.content.length > 50 ? '...' : ''),
            updated_at: new Date().toISOString()
          };
          dispatch({ type: 'UPDATE_CHAT_ROOM', payload: updatedRoom });
        }
        
        return response;
      } else {
        throw new Error('Invalid message response format');
      }
    } catch (error) {
      handleError(error, '메시지 전송에 실패했습니다.');
      throw error;
    }
  }, [safeState.currentChatRoom, handleError]);

  const deleteMessage = useCallback(async (messageId) => {
    if (!messageId) {
      handleError(new Error('메시지 ID가 필요합니다.'), '메시지 ID가 필요합니다.');
      return;
    }
    
    try {
      dispatch({ type: 'CLEAR_ERROR' });
      await chatService.deleteMessage(messageId);
      dispatch({ type: 'DELETE_MESSAGE', payload: messageId });
    } catch (error) {
      handleError(error, '메시지 삭제에 실패했습니다.');
    }
  }, [handleError]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const resetState = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
  }, []);

  // 디버깅을 위한 상태 로깅 (개발 환경에서만)
  if (process.env.NODE_ENV === 'development') {
    console.log('ChatContext state:', {
      chatRoomsCount: safeState.chatRooms.length,
      messagesCount: safeState.messages.length,
      currentChatRoom: safeState.currentChatRoom?.id,
      loading: safeState.loading,
      error: safeState.error
    });
  }

  const value = {
    ...safeState,
    loadChatRooms,
    createChatRoom,
    updateChatRoomTitle,
    deleteChatRoom,
    selectChatRoom,
    sendMessage,
    deleteMessage,
    clearError,
    resetState
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

export { ChatContext };