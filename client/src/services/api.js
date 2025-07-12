import axios from 'axios';
import { API_BASE_URL } from '../utils/constants';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터 - JWT 토큰 자동 추가
api.interceptors.request.use(
  (config) => {
    // localStorage에서 토큰 가져오기
    const token = localStorage.getItem('token');
    
    // 토큰이 있으면 Authorization 헤더에 추가
    if (token && !config.url.includes('/auth/register')) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터 - 401 에러 처리
api.interceptors.response.use(
  (response) => {
    // 성공적인 응답은 그대로 반환
    return response;
  },
  (error) => {
    // 401 Unauthorized 에러 처리
    if (error.response?.status === 401) {
      // 토큰이 만료되었거나 유효하지 않은 경우
      // 로컬 스토리지에서 인증 정보 삭제
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('isAuthenticated');
      
      // 로그인 페이지로 리다이렉트
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

export default api;