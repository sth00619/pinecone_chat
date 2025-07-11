const pineconeDao = require('../dao/pineconeDao');
require('dotenv').config();

/**
 * 로컬 DB 없이 Pinecone을 독립적으로 설정하는 스크립트
 */

// 환경 변수 확인
console.log('환경 변수 확인:');
console.log('PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? '설정됨' : '설정 안됨');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '설정됨' : '설정 안됨');
console.log('PINECONE_INDEX_NAME:', process.env.PINECONE_INDEX_NAME || 'seoultech-knowledge');
console.log('');

// 샘플 지식 데이터
const sampleKnowledgeData = [
  // 학교 소개
  {
    question: "서울과학기술대학교는 언제 설립되었나요?",
    answer: "서울과학기술대학교는 1910년 4월 15일 공립어의동실업보습학교로 설립되었습니다. 이후 여러 차례 교명 변경을 거쳐 2010년에 현재의 서울과학기술대학교로 교명을 변경했습니다.",
    keywords: "설립, 역사, 1910년, 공립어의동실업보습학교, 교명변경",
    category: "학교소개",
    priority: 10
  },
  {
    question: "서울과학기술대학교의 위치는 어디인가요?",
    answer: "서울과학기술대학교는 서울특별시 노원구 공릉로 232(공릉동 172번지)에 위치하고 있습니다. 지하철 7호선 공릉역에서 도보로 약 10분 거리에 있습니다.",
    keywords: "위치, 주소, 노원구, 공릉, 캠퍼스, 지하철, 공릉역",
    category: "학교소개",
    priority: 9
  },
  {
    question: "서울과기대의 교훈은 무엇인가요?",
    answer: "서울과학기술대학교의 교훈은 '성실, 창의, 협동'입니다. 이는 성실한 자세로 창의적 사고를 기르고 서로 협동하는 인재를 양성하겠다는 교육 이념을 담고 있습니다.",
    keywords: "교훈, 성실, 창의, 협동, 교육이념",
    category: "학교소개",
    priority: 8
  },
  
  // 입학 정보
  {
    question: "서울과기대 입학 전형에는 어떤 것들이 있나요?",
    answer: "서울과학기술대학교의 주요 입학 전형으로는 학생부종합전형, 학생부교과전형, 논술전형, 실기전형 등이 있습니다. 수시모집과 정시모집으로 나누어 선발하며, 전형별로 지원 자격과 전형 방법이 다릅니다.",
    keywords: "입학전형, 수시, 정시, 학생부종합, 학생부교과, 논술, 실기",
    category: "입학",
    priority: 10
  },
  {
    question: "서울과기대 입학 경쟁률은 어떻게 되나요?",
    answer: "서울과학기술대학교의 입학 경쟁률은 전형과 학과에 따라 다르지만, 평균적으로 수시는 10:1에서 20:1, 정시는 5:1에서 10:1 정도입니다. 인기 학과의 경우 더 높은 경쟁률을 보입니다.",
    keywords: "경쟁률, 입학경쟁률, 수시경쟁률, 정시경쟁률",
    category: "입학",
    priority: 8
  },
  
  // 학과 정보
  {
    question: "서울과기대에는 어떤 단과대학들이 있나요?",
    answer: "서울과학기술대학교에는 공과대학, 정보통신대학, 에너지바이오대학, 조형대학, 인문사회대학, 기술경영융합대학, 미래융합대학 등 7개 단과대학이 있습니다.",
    keywords: "단과대학, 공과대학, 정보통신대학, 에너지바이오대학, 조형대학, 인문사회대학, 기술경영융합대학, 미래융합대학",
    category: "학과정보",
    priority: 10
  },
  {
    question: "컴퓨터공학과는 어떤 것을 배우나요?",
    answer: "컴퓨터공학과에서는 프로그래밍, 자료구조, 알고리즘, 운영체제, 데이터베이스, 네트워크, 인공지능, 소프트웨어공학 등을 배웁니다. 이론과 실습을 통해 소프트웨어 개발 전문가를 양성합니다.",
    keywords: "컴퓨터공학과, 프로그래밍, 자료구조, 알고리즘, 인공지능, 소프트웨어",
    category: "학과정보",
    priority: 9
  },
  
  // 학사 정보
  {
    question: "졸업 학점은 몇 학점인가요?",
    answer: "서울과학기술대학교의 졸업 학점은 학과별로 다르지만, 일반적으로 130학점에서 140학점 사이입니다. 전공필수, 전공선택, 교양필수, 교양선택 등의 요건을 모두 충족해야 졸업이 가능합니다.",
    keywords: "졸업학점, 졸업요건, 전공필수, 교양필수, 학점",
    category: "학사",
    priority: 9
  },
  {
    question: "복수전공이나 부전공을 할 수 있나요?",
    answer: "네, 가능합니다. 서울과학기술대학교는 복수전공, 부전공, 연계전공 제도를 운영하고 있습니다. 일정 학점 이상을 이수하고 학과별 요건을 충족하면 신청할 수 있습니다.",
    keywords: "복수전공, 부전공, 연계전공, 다전공",
    category: "학사",
    priority: 8
  },
  
  // 캠퍼스 생활
  {
    question: "기숙사는 어떻게 신청하나요?",
    answer: "기숙사는 매 학기 시작 전에 온라인으로 신청합니다. 선발 기준은 거리점수와 성적을 합산하여 결정되며, 신입생은 별도의 선발 기준이 적용됩니다. 기숙사는 성림학사, KB학사, 누리학사 등이 있습니다.",
    keywords: "기숙사, 생활관, 성림학사, KB학사, 누리학사, 기숙사신청",
    category: "캠퍼스생활",
    priority: 9
  },
  {
    question: "학교 도서관은 언제까지 이용할 수 있나요?",
    answer: "중앙도서관은 학기 중 평일 오전 9시부터 오후 10시까지, 토요일은 오전 9시부터 오후 5시까지 운영됩니다. 시험기간에는 연장 운영되며, 24시간 열람실도 있습니다.",
    keywords: "도서관, 중앙도서관, 도서관운영시간, 열람실, 24시간열람실",
    category: "캠퍼스생활",
    priority: 8
  },
  
  // 장학금
  {
    question: "어떤 장학금이 있나요?",
    answer: "서울과학기술대학교에는 성적우수장학금, 가계곤란장학금, 국가장학금, 교내외장학금 등 다양한 장학제도가 있습니다. 성적 기준, 소득 기준 등에 따라 지원 자격이 다릅니다.",
    keywords: "장학금, 성적우수장학금, 가계곤란장학금, 국가장학금, 장학제도",
    category: "장학금",
    priority: 10
  },
  
  // 취업/진로
  {
    question: "취업률은 어떻게 되나요?",
    answer: "서울과학기술대학교의 취업률은 전국 4년제 대학 중 상위권에 속합니다. 학과별로 차이가 있지만 평균 70% 이상의 높은 취업률을 보이고 있으며, 특히 공학계열의 취업률이 높습니다.",
    keywords: "취업률, 졸업생취업률, 취업, 진로",
    category: "취업진로",
    priority: 9
  },
  {
    question: "어떤 기업들과 산학협력을 하고 있나요?",
    answer: "서울과학기술대학교는 삼성전자, LG전자, 현대자동차, SK하이닉스, 네이버, 카카오 등 국내 주요 대기업 및 중견기업들과 산학협력을 맺고 있습니다. 인턴십, 현장실습, 공동연구 등의 프로그램을 운영합니다.",
    keywords: "산학협력, 기업연계, 인턴십, 현장실습, 삼성, LG, 현대",
    category: "취업진로",
    priority: 8
  }
];

async function setupPinecone() {
  console.log('🚀 Pinecone 독립 설정을 시작합니다...\n');
  
  try {
    // Pinecone 초기화
    console.log('1️⃣ Pinecone 연결 중...');
    await pineconeDao.initialize();
    console.log('✅ Pinecone 연결 성공!\n');
    
    // 기존 데이터 확인
    console.log('2️⃣ 기존 데이터 확인 중...');
    const stats = await pineconeDao.getStats();
    console.log(`📊 현재 저장된 벡터 수: ${stats.totalRecordCount || 0}\n`);
    
    // 샘플 데이터 추가
    console.log('3️⃣ 샘플 데이터 추가 중...');
    const ids = await pineconeDao.addKnowledgeBatch(sampleKnowledgeData);
    console.log(`✅ ${ids.length}개의 지식이 추가되었습니다!\n`);
    
    // 추가된 데이터 확인
    console.log('4️⃣ 데이터 추가 확인...');
    const newStats = await pineconeDao.getStats();
    console.log(`📊 업데이트된 벡터 수: ${newStats.totalRecordCount || 0}\n`);
    
    // 검색 테스트
    console.log('5️⃣ 검색 테스트...');
    const testQueries = [
      "학교는 언제 만들어졌나요?",
      "기숙사 신청 방법",
      "컴공과에서 뭘 배우나요?"
    ];
    
    for (const query of testQueries) {
      console.log(`\n🔍 검색: "${query}"`);
      const result = await pineconeDao.searchAnswer(query, 1);
      
      if (result) {
        console.log(`✅ 매칭 (신뢰도: ${(result.score * 100).toFixed(1)}%)`);
        console.log(`📝 답변: ${result.answer.substring(0, 100)}...`);
      } else {
        console.log('❌ 매칭된 결과 없음');
      }
    }
    
    console.log('\n\n✨ Pinecone 설정이 완료되었습니다!');
    console.log('이제 다음 명령어로 관리할 수 있습니다:');
    console.log('- node server/src/utils/pineconeAdmin.js stats');
    console.log('- node server/src/utils/pineconeAdmin.js search "질문"');
    console.log('- node server/src/utils/pineconeAdmin.js list 학교소개');
    
  } catch (error) {
    console.error('\n❌ 오류 발생:', error);
    console.error('\n다음 사항을 확인해주세요:');
    console.error('1. .env 파일에 PINECONE_API_KEY가 설정되어 있는지');
    console.error('2. OPENAI_API_KEY가 설정되어 있는지');
    console.error('3. 인터넷 연결이 정상인지');
  }
  
  process.exit(0);
}

// 실행
setupPinecone();