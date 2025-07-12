const pineconeDao = require('../dao/pineconeDao');
require('dotenv').config();

async function listAllData() {
  console.log('📋 Pinecone 데이터 목록 조회\n');
  
  try {
    await pineconeDao.initialize();
    
    // 통계 먼저 확인
    const stats = await pineconeDao.getStats();
    console.log(`총 벡터 수: ${stats.totalRecordCount || 0}\n`);
    
    // 카테고리별로 조회 시도
    const categories = ['general', '학교소개', '입학', '학사', '캠퍼스생활', '취업진로', '장학금'];
    let allItems = [];
    
    for (const category of categories) {
      try {
        console.log(`🔍 카테고리 "${category}" 검색 중...`);
        
        // 각 카테고리에 대해 더미 쿼리 수행
        const dummyVector = Array(1536).fill(0);
        const response = await pineconeDao.client.index.query({
          vector: dummyVector,
          topK: 20,
          includeMetadata: true,
          filter: {
            category: { "$eq": category }
          }
        });
        
        if (response.matches && response.matches.length > 0) {
          console.log(`✅ ${response.matches.length}개 항목 발견`);
          allItems = allItems.concat(response.matches);
        }
      } catch (error) {
        console.log(`❌ 카테고리 ${category} 조회 실패:`, error.message);
      }
    }
    
    // 결과 출력
    console.log(`\n📊 총 ${allItems.length}개의 지식 항목:\n`);
    
    allItems.forEach((item, index) => {
      const metadata = item.metadata || {};
      console.log(`${index + 1}. [${metadata.category || 'N/A'}] ${metadata.question || 'No question'}`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Score: ${item.score.toFixed(3)}`);
      console.log(`   답변: ${(metadata.answer || 'No answer').substring(0, 50)}...`);
      console.log('');
    });
    
    // JSON으로 저장 옵션
    if (allItems.length > 0) {
      const fs = require('fs').promises;
      const filename = `pinecone_data_${new Date().toISOString().split('T')[0]}.json`;
      
      await fs.writeFile(
        filename,
        JSON.stringify({
          exportDate: new Date().toISOString(),
          totalItems: allItems.length,
          items: allItems
        }, null, 2)
      );
      
      console.log(`\n💾 데이터가 ${filename}으로 저장되었습니다.`);
    }
    
  } catch (error) {
    console.error('❌ 오류:', error);
  }
  
  process.exit(0);
}

// 실행
listAllData();