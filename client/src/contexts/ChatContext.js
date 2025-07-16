import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { chatService } from '../services/chatService';

const ChatContext = createContext();

const chatReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'SET_CHAT_ROOMS':
      return { ...state, chatRooms: action.payload };
    case 'ADD_CHAT_ROOM':
      return { ...state, chatRooms: [action.payload, ...state.chatRooms] };
    case 'UPDATE_CHAT_ROOM':
      return {
        ...state,
        chatRooms: state.chatRooms.map(room =>
          room.id === action.payload.id ? action.payload : room
        )
      };
    case 'DELETE_CHAT_ROOM':
      return {
        ...state,
        chatRooms: state.chatRooms.filter(room => room.id !== action.payload)
      };
    case 'SET_CURRENT_CHAT_ROOM':
      return { ...state, currentChatRoom: action.payload, messages: [] };
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'ADD_MESSAGES':
      return { ...state, messages: [...state.messages, ...action.payload] };
    case 'DELETE_MESSAGE':
      return {
        ...state,
        messages: state.messages.filter(msg => msg.id !== action.payload)
      };
    default:
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

  const handleError = useCallback((error, defaultMessage) => {
    const message = error.response?.data?.error || error.message || defaultMessage;
    dispatch({ type: 'SET_ERROR', payload: message });
  }, []);

  // 채팅방 관련 액션들
  const loadChatRooms = useCallback(async (userId) => {
    if (!userId) return;
    
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
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
      return;
    }
    
    try {
      const newChatRoom = await chatService.createChatRoom(userId, title);
      dispatch({ type: 'ADD_CHAT_ROOM', payload: newChatRoom });
      return newChatRoom;
    } catch (error) {
      handleError(error, '채팅방 생성에 실패했습니다.');
      throw error;
    }
  }, [handleError]);

  const updateChatRoomTitle = useCallback(async (chatRoomId, title) => {
    try {
      await chatService.updateChatRoomTitle(chatRoomId, title);
      const updatedRoom = { ...state.currentChatRoom, title };
      dispatch({ type: 'UPDATE_CHAT_ROOM', payload: updatedRoom });
      if (state.currentChatRoom?.id === chatRoomId) {
        dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: updatedRoom });
      }
    } catch (error) {
      handleError(error, '채팅방 제목 변경에 실패했습니다.');
    }
  }, [state.currentChatRoom, handleError]);

  const deleteChatRoom = useCallback(async (chatRoomId) => {
    try {
      await chatService.deleteChatRoom(chatRoomId);
      dispatch({ type: 'DELETE_CHAT_ROOM', payload: chatRoomId });
      if (state.currentChatRoom?.id === chatRoomId) {
        dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: null });
      }
    } catch (error) {
      handleError(error, '채팅방 삭제에 실패했습니다.');
    }
  }, [state.currentChatRoom, handleError]);

  const selectChatRoom = useCallback(async (chatRoom) => {
    try {
      dispatch({ type: 'SET_CURRENT_CHAT_ROOM', payload: chatRoom });
      dispatch({ type: 'SET_LOADING', payload: true });
      const messages = await chatService.getMessages(chatRoom.id);
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    } catch (error) {
      handleError(error, '메시지를 불러오는데 실패했습니다.');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [handleError]);

  // 메시지 관련 액션들
  const sendMessage = useCallback(async (content) => {
    if (!state.currentChatRoom) {
      handleError(new Error('채팅방을 선택해주세요.'), '채팅방을 선택해주세요.');
      return;
    }

    try {
      const response = await chatService.sendMessage(state.currentChatRoom.id, content);
      dispatch({ type: 'ADD_MESSAGE', payload: response.userMessage });
      dispatch({ type: 'ADD_MESSAGE', payload: response.botMessage });
      
      // 채팅방 목록의 마지막 메시지 업데이트
      const updatedRoom = {
        ...state.currentChatRoom,
        last_message: response.botMessage.content.substring(0, 50) + '...',
        updated_at: new Date().toISOString()
      };
      dispatch({ type: 'UPDATE_CHAT_ROOM', payload: updatedRoom });
      
      return response;
    } catch (error) {
      handleError(error, '메시지 전송에 실패했습니다.');
      throw error;
    }
  }, [state.currentChatRoom, handleError]);

  const deleteMessage = useCallback(async (messageId) => {
    try {
      await chatService.deleteMessage(messageId);
      dispatch({ type: 'DELETE_MESSAGE', payload: messageId });
    } catch (error) {
      handleError(error, '메시지 삭제에 실패했습니다.');
    }
  }, [handleError]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const value = {
    ...state,
    loadChatRooms,
    createChatRoom,
    updateChatRoomTitle,
    deleteChatRoom,
    selectChatRoom,
    sendMessage,
    deleteMessage,
    clearError
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