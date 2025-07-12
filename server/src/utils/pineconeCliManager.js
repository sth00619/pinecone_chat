const readline = require('readline');
const pineconeDao = require('../dao/pineconeDao');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

class PineconeCLI {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start() {
    console.log('\n🌲 Pinecone 데이터 관리 CLI\n');
    
    try {
      await pineconeDao.initialize();
      console.log('✅ Pinecone 연결 성공\n');
    } catch (error) {
      console.error('❌ Pinecone 연결 실패:', error.message);
      console.log('\n환경 변수를 확인하세요:');
      console.log('- PINECONE_API_KEY');
      console.log('- OPENAI_API_KEY');
      process.exit(1);
    }
    
    this.showMenu();
  }

  showMenu() {
    console.log('\n=== 메뉴 ===');
    console.log('1. 지식 추가');
    console.log('2. 지식 검색');
    console.log('3. 지식 목록 보기');
    console.log('4. 지식 업데이트');
    console.log('5. 지식 삭제');
    console.log('6. CSV 파일에서 일괄 추가');
    console.log('7. 통계 보기');
    console.log('8. JSON 내보내기');
    console.log('0. 종료');
    console.log('=============\n');

    this.rl.question('선택: ', (answer) => {
      this.handleMenuChoice(answer);
    });
  }

  async handleMenuChoice(choice) {
    switch (choice) {
      case '1':
        await this.addKnowledge();
        break;
      case '2':
        await this.searchKnowledge();
        break;
      case '3':
        await this.listKnowledge();
        break;
      case '4':
        await this.updateKnowledge();
        break;
      case '5':
        await this.deleteKnowledge();
        break;
      case '6':
        await this.importFromCSV();
        break;
      case '7':
        await this.showStats();
        break;
      case '8':
        await this.exportToJSON();
        break;
      case '0':
        console.log('\n👋 종료합니다.');
        this.rl.close();
        process.exit(0);
        break;
      default:
        console.log('\n❌ 잘못된 선택입니다.');
        this.showMenu();
    }
  }

  async addKnowledge() {
    console.log('\n📝 새 지식 추가\n');
    
    const question = await this.askQuestion('질문: ');
    const answer = await this.askQuestion('답변: ');
    const keywords = await this.askQuestion('키워드 (쉼표로 구분): ');
    const category = await this.askQuestion('카테고리 (기본: general): ') || 'general';
    const priority = parseInt(await this.askQuestion('우선순위 (0-10, 기본: 5): ') || '5');

    try {
      const id = await pineconeDao.addKnowledge({
        question,
        answer,
        keywords,
        category,
        priority
      });
      
      console.log(`\n✅ 지식이 추가되었습니다! ID: ${id}`);
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async searchKnowledge() {
    console.log('\n🔍 지식 검색\n');
    
    const query = await this.askQuestion('검색할 질문: ');
    
    try {
      console.log('\n검색 중...');
      const result = await pineconeDao.searchAnswer(query, 3);
      
      if (result) {
        console.log('\n✅ 검색 결과:');
        console.log(`📌 질문: ${result.question}`);
        console.log(`💬 답변: ${result.answer}`);
        console.log(`🏷️  카테고리: ${result.category}`);
        console.log(`📊 신뢰도: ${(result.score * 100).toFixed(1)}%`);
        console.log(`🔑 ID: ${result.id}`);
      } else {
        console.log('\n❌ 관련된 답변을 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async listKnowledge() {
    console.log('\n📋 지식 목록\n');
    
    try {
      const items = await pineconeDao.getAllKnowledge('', 20);
      
      if (items.length === 0) {
        console.log('저장된 지식이 없습니다.');
      } else {
        console.log(`총 ${items.length}개의 지식:\n`);
        items.forEach((item, index) => {
          console.log(`${index + 1}. [${item.category}] ${item.question}`);
          console.log(`   ID: ${item.id}`);
          console.log(`   답변: ${item.answer.substring(0, 50)}...`);
          console.log('');
        });
      }
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async updateKnowledge() {
    console.log('\n✏️ 지식 업데이트\n');
    
    const id = await this.askQuestion('업데이트할 지식의 ID: ');
    
    try {
      const existing = await pineconeDao.getKnowledgeById(id);
      if (!existing) {
        console.log('\n❌ 해당 ID의 지식을 찾을 수 없습니다.');
        this.showMenu();
        return;
      }
      
      console.log('\n현재 내용:');
      console.log(`질문: ${existing.question}`);
      console.log(`답변: ${existing.answer}`);
      console.log(`키워드: ${existing.keywords}`);
      console.log(`카테고리: ${existing.category}`);
      console.log('\n새 내용 입력 (Enter로 기존값 유지):\n');
      
      const question = await this.askQuestion(`질문 [${existing.question}]: `) || existing.question;
      const answer = await this.askQuestion(`답변 [${existing.answer.substring(0, 50)}...]: `) || existing.answer;
      const keywords = await this.askQuestion(`키워드 [${existing.keywords}]: `) || existing.keywords;
      const category = await this.askQuestion(`카테고리 [${existing.category}]: `) || existing.category;
      
      await pineconeDao.updateKnowledge(id, {
        question,
        answer,
        keywords,
        category
      });
      
      console.log('\n✅ 지식이 업데이트되었습니다!');
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async deleteKnowledge() {
    console.log('\n🗑️ 지식 삭제\n');
    
    const id = await this.askQuestion('삭제할 지식의 ID: ');
    const confirm = await this.askQuestion('정말로 삭제하시겠습니까? (y/n): ');
    
    if (confirm.toLowerCase() === 'y') {
      try {
        await pineconeDao.deleteKnowledge(id);
        console.log('\n✅ 지식이 삭제되었습니다!');
      } catch (error) {
        console.error('\n❌ 오류:', error.message);
      }
    } else {
      console.log('\n취소되었습니다.');
    }
    
    this.showMenu();
  }

  async importFromCSV() {
    console.log('\n📁 CSV 파일에서 일괄 추가\n');
    console.log('CSV 형식: question,answer,keywords,category,priority');
    
    const filename = await this.askQuestion('CSV 파일 경로: ');
    
    try {
      const content = await fs.readFile(filename, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const dataLines = lines.slice(1);
      const items = [];
      
      for (const line of dataLines) {
        const [question, answer, keywords, category, priority] = line.split(',').map(s => s.trim());
        if (question && answer && keywords) {
          items.push({
            question,
            answer,
            keywords,
            category: category || 'general',
            priority: parseInt(priority) || 5
          });
        }
      }
      
      if (items.length === 0) {
        console.log('\n❌ 유효한 데이터가 없습니다.');
      } else {
        console.log(`\n${items.length}개의 항목을 추가합니다...`);
        const ids = await pineconeDao.addKnowledgeBatch(items);
        console.log(`\n✅ ${ids.length}개의 지식이 추가되었습니다!`);
      }
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async showStats() {
    console.log('\n📊 Pinecone 통계\n');
    
    try {
      const stats = await pineconeDao.getStats();
      console.log(JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  async exportToJSON() {
    console.log('\n💾 JSON으로 내보내기\n');
    
    const filename = await this.askQuestion('저장할 파일명 (기본: pinecone_export.json): ') || 'pinecone_export.json';
    
    try {
      console.log('\n데이터를 가져오는 중...');
      const items = await pineconeDao.getAllKnowledge('', 1000);
      
      const exportData = {
        exportDate: new Date().toISOString(),
        totalItems: items.length,
        items: items.map(item => ({
          id: item.id,
          question: item.question,
          answer: item.answer,
          keywords: item.keywords,
          category: item.category,
          priority: item.priority,
          createdAt: item.createdAt
        }))
      };
      
      await fs.writeFile(filename, JSON.stringify(exportData, null, 2));
      console.log(`\n✅ ${items.length}개의 지식이 ${filename}로 내보내졌습니다!`);
    } catch (error) {
      console.error('\n❌ 오류:', error.message);
    }
    
    this.showMenu();
  }

  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }
}

// 메인 실행
if (require.main === module) {
  const cli = new PineconeCLI();
  cli.start().catch(console.error);
}