const pineconeDao = require('../dao/pineconeDao');
const knowledgeDao = require('../dao/knowledgeDao');
require('dotenv').config();

/**
 * Pinecone 관리 유틸리티
 * 커맨드라인에서 실행: node server/src/utils/pineconeAdmin.js [command]
 */

class PineconeAdmin {
  // 로컬 DB에서 Pinecone으로 전체 마이그레이션
  async migrateFromLocalDB() {
    console.log('🚀 Starting migration from local DB to Pinecone...');
    
    try {
      const categories = await knowledgeDao.getAllCategories();
      let totalMigrated = 0;
      
      for (const category of categories) {
        console.log(`\n📁 Processing category: ${category.name}`);
        const items = await knowledgeDao.getByCategory(category.id);
        
        if (items.length > 0) {
          const pineconeItems = items.map(item => ({
            id: `local-${item.id}`, // 로컬 DB ID 보존
            question: item.question,
            answer: item.answer,
            keywords: item.keywords,
            category: category.name,
            priority: item.priority || 0,
            metadata: {
              originalId: item.id,
              source: 'localdb'
            }
          }));
          
          await pineconeDao.addKnowledgeBatch(pineconeItems);
          totalMigrated += items.length;
          console.log(`✅ Migrated ${items.length} items from ${category.name}`);
        }
      }
      
      console.log(`\n✨ Migration completed! Total items migrated: ${totalMigrated}`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
    }
  }

  // Pinecone 인덱스 통계 확인
  async checkStats() {
    console.log('📊 Fetching Pinecone index statistics...');
    
    try {
      const stats = await pineconeDao.getStats();
      console.log('\n📈 Index Statistics:');
      console.log(JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('❌ Failed to fetch stats:', error);
    }
  }

  // 샘플 데이터 추가
  async addSampleData() {
    console.log('📝 Adding sample data to Pinecone...');
    
    const sampleData = [
      {
        question: "서울과학기술대학교는 언제 설립되었나요?",
        answer: "서울과학기술대학교는 1910년 4월 15일 공립어의동실업보습학교로 설립되었습니다. 이후 여러 차례 교명 변경을 거쳐 2010년에 현재의 서울과학기술대학교로 교명을 변경했습니다.",
        keywords: "설립, 역사, 1910년, 공립어의동실업보습학교",
        category: "학교소개",
        priority: 10
      },
      {
        question: "서울과학기술대학교의 캠퍼스는 어디에 있나요?",
        answer: "서울과학기술대학교는 서울특별시 노원구 공릉로 232(공릉동 172번지)에 위치하고 있습니다. 지하철 7호선 공릉역에서 도보로 약 10분 거리에 있습니다.",
        keywords: "위치, 주소, 노원구, 공릉, 캠퍼스",
        category: "학교소개",
        priority: 9
      },
      {
        question: "학교 상징물은 무엇인가요?",
        answer: "서울과학기술대학교의 상징동물은 호랑이이며, 교목은 느티나무, 교화는 목련입니다. UI 컬러는 SEOULTECH Blue와 SEOULTECH Gray입니다.",
        keywords: "상징, 호랑이, 느티나무, 목련, UI",
        category: "학교소개",
        priority: 8
      }
    ];
    
    try {
      const ids = await pineconeDao.addKnowledgeBatch(sampleData);
      console.log(`✅ Added ${ids.length} sample items to Pinecone`);
    } catch (error) {
      console.error('❌ Failed to add sample data:', error);
    }
  }

  // 검색 테스트
  async testSearch(query) {
    console.log(`🔍 Testing search for: "${query}"`);
    
    try {
      const result = await pineconeDao.searchAnswer(query, 3);
      
      if (result) {
        console.log('\n✅ Search Results:');
        console.log(`Score: ${result.score}`);
        console.log(`Question: ${result.question}`);
        console.log(`Answer: ${result.answer}`);
        console.log(`Category: ${result.category}`);
      } else {
        console.log('\n❌ No relevant results found');
      }
    } catch (error) {
      console.error('❌ Search failed:', error);
    }
  }

  // 특정 카테고리의 모든 항목 조회
  async listByCategory(category) {
    console.log(`📂 Listing all items in category: ${category}`);
    
    try {
      // 임의의 쿼리로 카테고리 필터링 검색
      const results = await pineconeDao.searchByCategory("", category, 100);
      
      console.log(`\n📋 Found ${results.length} items:`);
      results.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.question}`);
        console.log(`   Answer: ${item.answer.substring(0, 100)}...`);
        console.log(`   Keywords: ${item.keywords}`);
      });
    } catch (error) {
      console.error('❌ Failed to list by category:', error);
    }
  }

  // 인덱스 초기화 (주의: 모든 데이터 삭제)
  async clearIndex() {
    console.log('⚠️  WARNING: This will delete ALL data in the Pinecone index!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      // Pinecone은 전체 삭제 API를 직접 제공하지 않으므로
      // 모든 벡터를 조회한 후 삭제해야 함
      const allItems = await pineconeDao.getAllKnowledge('', 1000);
      const ids = allItems.map(item => item.id);
      
      if (ids.length > 0) {
        await pineconeDao.deleteKnowledge(ids);
        console.log(`✅ Deleted ${ids.length} items from Pinecone`);
      } else {
        console.log('ℹ️  Index is already empty');
      }
    } catch (error) {
      console.error('❌ Failed to clear index:', error);
    }
  }
}

// CLI 실행
const admin = new PineconeAdmin();
const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case 'migrate':
      await admin.migrateFromLocalDB();
      break;
    case 'stats':
      await admin.checkStats();
      break;
    case 'sample':
      await admin.addSampleData();
      break;
    case 'search':
      if (args.length === 0) {
        console.log('Usage: node pineconeAdmin.js search "your query"');
        break;
      }
      await admin.testSearch(args.join(' '));
      break;
    case 'list':
      if (args.length === 0) {
        console.log('Usage: node pineconeAdmin.js list [category]');
        break;
      }
      await admin.listByCategory(args[0]);
      break;
    case 'clear':
      await admin.clearIndex();
      break;
    default:
      console.log('📚 Pinecone Admin Tool');
      console.log('\nAvailable commands:');
      console.log('  migrate    - Migrate all data from local DB to Pinecone');
      console.log('  stats      - Show index statistics');
      console.log('  sample     - Add sample data');
      console.log('  search     - Test search functionality');
      console.log('  list       - List items by category');
      console.log('  clear      - Clear all data (use with caution!)');
      console.log('\nExample:');
      console.log('  node pineconeAdmin.js search "학교 역사"');
  }
  
  process.exit(0);
}

main().catch(console.error);