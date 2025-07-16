import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { showSwaggerToken } from '../../utils/swaggerHelper';
import Layout from '../../common/Layout';
import ChatRoom from '../chat/ChatRoom';
import { ROUTES } from '../../utils/constants';

const ChatPage = () => {
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    // 페이지 로드시 토큰 확인
    const token = localStorage.getItem('token');
    console.log('ChatPage - Token:', token);
    console.log('ChatPage - isAuthenticated:', isAuthenticated);
    
    // Swagger용 토큰 출력 (개발 환경에서만)
    if (token && process.env.NODE_ENV === 'development') {
      console.log('%c🔐 Swagger 인증 토큰이 준비되었습니다!', 'color: #2ecc71; font-size: 14px; font-weight: bold;');
      showSwaggerToken();
    }
  }, [isAuthenticated]);

  if (loading) {
    return (
      <Layout>
        <div className="page-loading">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) {
    console.log('ChatPage - Not authenticated, redirecting to login');
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  return (
    <Layout showHeader={false} showFooter={false}>
      <div className="chat-page">
        <ChatRoom />
      </div>
    </Layout>
  );
};

export default ChatPage;