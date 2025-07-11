const path = require('path');
const fs = require('fs');
require('dotenv').config();

console.log('🔍 환경 변수 디버깅\n');

// 현재 작업 디렉토리
console.log('현재 작업 디렉토리:', process.cwd());

// .env 파일 위치 확인
const envPath = path.resolve(process.cwd(), '.env');
console.log('.env 파일 경로:', envPath);
console.log('.env 파일 존재:', fs.existsSync(envPath) ? '✅ 있음' : '❌ 없음');

// 환경 변수 확인
console.log('\n환경 변수 상태:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? `✅ 설정됨 (${process.env.PINECONE_API_KEY.substring(0, 10)}...)` : '❌ 설정 안됨');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `✅ 설정됨 (${process.env.OPENAI_API_KEY.substring(0, 10)}...)` : '❌ 설정 안됨');
console.log('PINECONE_INDEX_NAME:', process.env.PINECONE_INDEX_NAME || 'not set');

// .env 파일 내용 확인 (API 키는 일부만 표시)
if (fs.existsSync(envPath)) {
  console.log('\n.env 파일 내용 (일부):');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  lines.forEach(line => {
    if (line.includes('PINECONE_API_KEY') || line.includes('OPENAI_API_KEY')) {
      const [key, value] = line.split('=');
      if (value && value.trim()) {
        console.log(`${key}=${value.substring(0, 20)}...`);
      }
    } else if (line.includes('PINECONE_')) {
      console.log(line);
    }
  });
}

// 다른 .env 파일 찾기
console.log('\n다른 .env 파일 검색:');
const searchPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env')
];

searchPaths.forEach(p => {
  if (fs.existsSync(p)) {
    console.log(`✅ 발견: ${p}`);
  }
});