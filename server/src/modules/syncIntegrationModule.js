// server/src/modules/syncIntegrationModule.js
const knowledgeDao = require('../dao/knowledgeDao');
const pineconeDao = require('../dao/pineconeDao');
const learningEngine = require('./learningEngine');
const personalDataDao = require('../dao/personalDataDao');
const redis = require('../config/redis');

class SyncIntegrationModule {
  constructor() {
    this.syncInterval = null;
    this.isSyncing = false;
  }

  // 동기화 시작
  startSync() {
    console.log('🔄 Starting sync integration module');
    
    // 30분마다 동기화 실행
    this.syncInterval = setInterval(() => {
      this.performFullSync();
    }, 30 * 60 * 1000);
    
    // 학습 엔진 시작
    learningEngine.start();
    
    // 초기 동기화 실행
    this.performFullSync();
  }

  // 동기화 중지
  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    learningEngine.stop();
    console.log('🛑 Sync integration module stopped');
  }

  // 전체 동기화 수행
  async performFullSync() {
    if (this.isSyncing) {
      console.log('⏳ Sync already in progress, skipping');
      return;
    }

    this.isSyncing = true;
    console.log('🔄 Starting full sync process');

    try {
      // 1. Pinecone → RDBMS 동기화
      await this.syncPineconeToRDBMS();
      
      // 2. 고성능 로컬 답변 → Pinecone 동기화
      await this.syncHighPerformingLocalToPinecone();
      
      // 3. 캐시 정리
      await this.cleanupCacheWithPersonalData();
      
      // 4. 통계 업데이트
      await this.updateSyncStats();
      
      console.log('✅ Full sync completed successfully');
    } catch (error) {
      console.error('❌ Error during full sync:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Missing Implementation 1: Pinecone → RDBMS 동기화
  async syncPineconeToRDBMS() {
    try {
      console.log('📥 Syncing from Pinecone to RDBMS...');
      
      // Pinecone에서 모든 지식 가져오기 (상위 1000개)
      const pineconeKnowledge = await pineconeDao.getAllKnowledge('', 1000);
      
      let syncedCount = 0;
      let skippedCount = 0;
      
      for (const item of pineconeKnowledge) {
        try {
          // 이미 동기화된 항목인지 확인
          const existing = await knowledgeDao.findByPineconeId(item.id);
          
          if (!existing && item.score > 0.8) {
            // 개인정보 포함 여부 확인
            const hasPersonalData = await this.checkForPersonalData(
              item.question + ' ' + item.answer
            );
            
            if (!hasPersonalData) {
              // 새로운 고품질 지식을 RDBMS에 추가
              await knowledgeDao.createFromPinecone({
                pinecone_id: item.id,
                question: item.question,
                answer: item.answer,
                keywords: item.keywords,
                category: item.category,
                priority: item.priority || 5,
                performance_score: item.score,
                usage_count: 0,
                source: 'pinecone_sync'
              });
              
              syncedCount++;
              console.log(`✅ Synced Pinecone knowledge ${item.id} to RDBMS`);
            } else {
              console.log(`⚠️ Skipped ${item.id} due to personal data`);
              skippedCount++;
            }
          }
        } catch (error) {
          console.error(`Error syncing item ${item.id}:`, error);
        }
      }
      
      console.log(`📊 Pinecone → RDBMS sync complete: ${syncedCount} added, ${skippedCount} skipped`);
    } catch (error) {
      console.error('Error in syncPineconeToRDBMS:', error);
    }
  }

  // 고성능 로컬 답변을 Pinecone으로 동기화
  async syncHighPerformingLocalToPinecone() {
    try {
      console.log('📤 Syncing high-performing local answers to Pinecone...');
      
      // 성능이 좋은 로컬 지식 조회
      const query = `
        SELECT 
          kb.*,
          kc.name as category_name,
          COUNT(ca.id) as usage_count,
          AVG(ca.user_feedback) as avg_feedback
        FROM knowledge_base kb
        JOIN knowledge_categories kc ON kb.category_id = kc.id
        LEFT JOIN chat_analytics ca ON kb.id = ca.matched_knowledge_id
        LEFT JOIN knowledge_pinecone_sync kps ON kb.id = kps.knowledge_base_id
        WHERE kb.is_active = TRUE
          AND kps.id IS NULL  -- Pinecone에 없는 것만
          AND ca.id IS NOT NULL  -- 사용된 적이 있는 것만
        GROUP BY kb.id
        HAVING usage_count > 5 AND (avg_feedback IS NULL OR avg_feedback >= 4)
        ORDER BY usage_count DESC
        LIMIT 50
      `;
      
      const [highPerformers] = await knowledgeDao.pool.query(query);
      
      let syncedCount = 0;
      
      for (const knowledge of highPerformers) {
        try {
          // 개인정보 확인
          const hasPersonalData = await this.checkForPersonalData(
            knowledge.question + ' ' + knowledge.answer
          );
          
          if (!hasPersonalData) {
            // Pinecone에 추가
            const pineconeId = await pineconeDao.addKnowledge({
              question: knowledge.question,
              answer: knowledge.answer,
              keywords: knowledge.keywords,
              category: knowledge.category_name,
              priority: knowledge.priority,
              metadata: {
                localId: knowledge.id,
                source: 'rdbms_sync',
                usageCount: knowledge.usage_count,
                avgFeedback: knowledge.avg_feedback
              }
            });
            
            // 동기화 매핑 저장
            await knowledgeDao.pool.query(
              `INSERT INTO knowledge_pinecone_sync 
               (knowledge_base_id, pinecone_id, sync_direction, performance_score, usage_count) 
               VALUES (?, ?, 'to_pinecone', ?, ?)`,
              [knowledge.id, pineconeId, knowledge.avg_feedback || 4.0, knowledge.usage_count]
            );
            
            syncedCount++;
            console.log(`✅ Synced local knowledge ${knowledge.id} to Pinecone`);
          }
        } catch (error) {
          console.error(`Error syncing knowledge ${knowledge.id}:`, error);
        }
      }
      
      console.log(`📊 RDBMS → Pinecone sync complete: ${syncedCount} added`);
    } catch (error) {
      console.error('Error in syncHighPerformingLocalToPinecone:', error);
    }
  }

  // Missing Implementation 3: Redis 캐시 관리
  async cleanupCacheWithPersonalData() {
    try {
      console.log('🧹 Cleaning up cache with personal data...');
      
      // 최근 개인정보가 감지된 메시지 조회
      const query = `
        SELECT DISTINCT m.content, pdl.data_type
        FROM personal_data_logs pdl
        JOIN messages m ON pdl.message_id = m.id
        WHERE pdl.created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
          AND pdl.action_taken IN ('masked', 'blocked')
      `;
      
      const [personalDataMessages] = await knowledgeDao.pool.query(query);
      
      let cleanedCount = 0;
      
      for (const message of personalDataMessages) {
        // 해당 메시지와 관련된 캐시 키 생성
        const cacheKey = `chat:${this.generateCacheKey(message.content)}`;
        
        try {
          const exists = await redis.exists(cacheKey);
          if (exists) {
            await redis.del(cacheKey);
            cleanedCount++;
            console.log(`🗑️ Removed cache key containing ${message.data_type}`);
          }
        } catch (error) {
          console.error('Redis error:', error);
        }
      }
      
      console.log(`📊 Cache cleanup complete: ${cleanedCount} entries removed`);
    } catch (error) {
      console.error('Error in cleanupCacheWithPersonalData:', error);
    }
  }

  // 동기화 통계 업데이트
  async updateSyncStats() {
    try {
      // Pinecone 통계
      const pineconeStats = await pineconeDao.getStats();
      
      // 로컬 DB 통계
      const [localStats] = await knowledgeDao.pool.query(`
        SELECT 
          COUNT(DISTINCT kb.id) as total_knowledge,
          COUNT(DISTINCT kps.id) as synced_count,
          AVG(kps.performance_score) as avg_performance
        FROM knowledge_base kb
        LEFT JOIN knowledge_pinecone_sync kps ON kb.id = kps.knowledge_base_id
        WHERE kb.is_active = TRUE
      `);
      
      console.log('📊 Sync Statistics:');
      console.log(`  - Pinecone vectors: ${pineconeStats.totalRecordCount || 0}`);
      console.log(`  - Local knowledge: ${localStats[0].total_knowledge}`);
      console.log(`  - Synced items: ${localStats[0].synced_count}`);
      console.log(`  - Avg performance: ${(localStats[0].avg_performance || 0).toFixed(2)}`);
      
      // Redis에 통계 캐시
      await redis.setex('sync:stats', 3600, JSON.stringify({
        timestamp: new Date().toISOString(),
        pinecone: pineconeStats,
        local: localStats[0]
      }));
      
    } catch (error) {
      console.error('Error updating sync stats:', error);
    }
  }

  // 유틸리티 메서드들
  async checkForPersonalData(text) {
    const detectedData = await personalDataDao.detectPersonalDataType(text);
    return detectedData.length > 0;
  }

  generateCacheKey(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content.toLowerCase()).digest('hex');
  }

  // 수동 동기화 트리거
  async triggerManualSync(type = 'full') {
    console.log(`🔄 Manual sync triggered: ${type}`);
    
    switch (type) {
      case 'pinecone-to-rdbms':
        await this.syncPineconeToRDBMS();
        break;
      case 'rdbms-to-pinecone':
        await this.syncHighPerformingLocalToPinecone();
        break;
      case 'cache-cleanup':
        await this.cleanupCacheWithPersonalData();
        break;
      case 'full':
      default:
        await this.performFullSync();
        break;
    }
    
    return { success: true, message: `${type} sync completed` };
  }
}

module.exports = new SyncIntegrationModule();