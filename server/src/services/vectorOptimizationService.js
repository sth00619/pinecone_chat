// server/src/services/vectorOptimizationService.js
const pineconeDao = require('../dao/pineconeDao');

class VectorOptimizationService {
  constructor() {
    this.cache = new Map();
    this.semanticCache = new Map();
    this.queryOptimizer = new QueryOptimizer();
  }

  /**
   * 1. 의미적 캐싱 시스템
   * 유사한 질문들을 캐시하여 Pinecone 호출 횟수 감소
   */
  async getAnswerWithSemanticCache(userQuery) {
    const queryEmbedding = await pineconeDao.client.createEmbedding(userQuery);
    
    // 캐시에서 유사한 쿼리 검색
    const cachedResult = await this.findSimilarCachedQuery(queryEmbedding);
    
    if (cachedResult && cachedResult.similarity > 0.95) {
      console.log('✅ Cache hit - returning cached result');
      return cachedResult.answer;
    }
    
    // 캐시 미스 - Pinecone 검색 후 캐시에 저장
    const result = await pineconeDao.searchAnswer(userQuery);
    
    if (result) {
      this.addToSemanticCache(queryEmbedding, userQuery, result);
    }
    
    return result;
  }

  /**
   * 2. 쿼리 최적화 시스템
   * 사용자 쿼리를 여러 방식으로 변형하여 검색 정확도 향상
   */
  async optimizedSearch(userQuery) {
    const optimizedQueries = await this.queryOptimizer.generateVariations(userQuery);
    
    // 병렬로 여러 버전의 쿼리 실행
    const results = await Promise.all(
      optimizedQueries.map(query => 
        pineconeDao.searchAnswer(query.text, 3).catch(() => null)
      )
    );
    
    // 결과 통합 및 순위 조정
    return this.mergeAndRankResults(results, optimizedQueries);
  }

  /**
   * 3. 벡터 압축 및 차원 축소
   * 저장 공간 최적화 및 검색 속도 향상
   */
  async compressVectors(vectors) {
    // PCA 또는 다른 차원 축소 기법 적용
    const compressedVectors = await this.applyDimensionReduction(vectors);
    
    // 압축된 벡터와 원본 벡터의 품질 비교
    const qualityScore = await this.evaluateCompressionQuality(vectors, compressedVectors);
    
    if (qualityScore > 0.9) {
      return compressedVectors;
    }
    
    return vectors; // 품질이 떨어지면 원본 사용
  }

  /**
   * 4. 동적 인덱스 관리
   * 오래된 데이터 정리 및 중요도 기반 재배치
   */
  async optimizeIndex() {
    console.log('🔧 Starting index optimization...');
    
    // 사용 빈도가 낮은 오래된 데이터 식별
    const lowUsageVectors = await this.identifyLowUsageVectors();
    
    // 중복도가 높은 벡터 식별
    const duplicateVectors = await this.findDuplicateVectors();
    
    // 정리 작업 수행
    if (lowUsageVectors.length > 0) {
      console.log(`🗑️ Removing ${lowUsageVectors.length} low-usage vectors`);
      await pineconeDao.deleteKnowledge(lowUsageVectors.map(v => v.id));
    }
    
    if (duplicateVectors.length > 0) {
      console.log(`🔄 Merging ${duplicateVectors.length} duplicate vectors`);
      await this.mergeDuplicateVectors(duplicateVectors);
    }
    
    // 인덱스 재구성
    await this.rebalanceIndex();
  }

  /**
   * 5. 실시간 성능 모니터링
   */
  async monitorPerformance() {
    const metrics = {
      averageSearchTime: await this.calculateAverageSearchTime(),
      cacheHitRate: this.calculateCacheHitRate(),
      indexSize: await this.getIndexSize(),
      queryAccuracy: await this.calculateQueryAccuracy()
    };
    
    console.log('📊 Performance Metrics:', metrics);
    
    // 성능 임계값 체크
    if (metrics.averageSearchTime > 2000) { // 2초 이상
      console.warn('⚠️ Search time is too high, consider optimization');
      await this.autoOptimize();
    }
    
    return metrics;
  }

  /**
   * 6. 자동 최적화 트리거
   */
  async autoOptimize() {
    const optimizationTasks = [
      this.optimizeIndex(),
      this.cleanupCache(),
      this.rebalanceVectorDistribution()
    ];
    
    await Promise.all(optimizationTasks);
    console.log('✅ Auto-optimization completed');
  }

  // 헬퍼 메서드들
  async findSimilarCachedQuery(queryEmbedding) {
    let bestMatch = null;
    let bestSimilarity = 0;
    
    for (const [cachedEmbedding, cachedData] of this.semanticCache.entries()) {
      const similarity = this.calculateCosineSimilarity(queryEmbedding, cachedEmbedding);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { ...cachedData, similarity };
      }
    }
    
    return bestMatch;
  }

  addToSemanticCache(embedding, query, answer) {
    // 캐시 크기 제한
    if (this.semanticCache.size >= 1000) {
      const oldestKey = this.semanticCache.keys().next().value;
      this.semanticCache.delete(oldestKey);
    }
    
    this.semanticCache.set(embedding, {
      query,
      answer,
      timestamp: Date.now(),
      accessCount: 1
    });
  }

  calculateCosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    
    return dotProduct / (magnitudeA * magnitudeB);
  }

  async identifyLowUsageVectors() {
    // 사용 빈도가 낮은 벡터들을 식별하는 로직
    // 실제로는 별도의 사용 통계 테이블이 필요
    return [];
  }

  async findDuplicateVectors() {
    // 유사도가 매우 높은 벡터들을 찾는 로직
    return [];
  }

  async mergeDuplicateVectors(duplicates) {
    // 중복 벡터들을 하나로 합치는 로직
  }

  async rebalanceIndex() {
    // 인덱스 재균형 로직
  }

  calculateCacheHitRate() {
    // 캐시 히트율 계산
    return 0.85; // 예시 값
  }

  async calculateAverageSearchTime() {
    // 평균 검색 시간 계산
    return 800; // 예시 값 (밀리초)
  }

  async getIndexSize() {
    const stats = await pineconeDao.getStats();
    return stats.totalRecordCount || 0;
  }

  async calculateQueryAccuracy() {
    // 쿼리 정확도 계산 (사용자 피드백 기반)
    return 0.92; // 예시 값
  }
}

/**
 * 쿼리 최적화 클래스
 */
class QueryOptimizer {
  async generateVariations(originalQuery) {
    const variations = [
      { text: originalQuery, weight: 1.0, type: 'original' },
      { text: await this.expandQuery(originalQuery), weight: 0.8, type: 'expanded' },
      { text: await this.simplifyQuery(originalQuery), weight: 0.7, type: 'simplified' },
      { text: await this.addSynonyms(originalQuery), weight: 0.6, type: 'synonym' }
    ];
    
    return variations.filter(v => v.text && v.text.trim().length > 0);
  }

  async expandQuery(query) {
    // 쿼리 확장 로직 (관련 키워드 추가)
    const expansionMap = {
      '학교': '서울과학기술대학교 대학교 학교',
      '입학': '입학 모집 지원 접수',
      '기숙사': '기숙사 생활관 학생회관',
      '장학금': '장학금 학비 등록금 지원금'
    };
    
    let expandedQuery = query;
    for (const [keyword, expansion] of Object.entries(expansionMap)) {
      if (query.includes(keyword)) {
        expandedQuery += ` ${expansion}`;
      }
    }
    
    return expandedQuery;
  }

  async simplifyQuery(query) {
    // 불필요한 조사, 어미 제거
    return query
      .replace(/[은는이가을를에게서와과]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async addSynonyms(query) {
    // 동의어 추가
    const synonymMap = {
      '대학교': '학교',
      '학과': '전공',
      '수업': '강의',
      '시험': '평가'
    };
    
    let synonymQuery = query;
    for (const [word, synonym] of Object.entries(synonymMap)) {
      if (query.includes(word)) {
        synonymQuery += ` ${synonym}`;
      }
    }
    
    return synonymQuery;
  }
}

module.exports = new VectorOptimizationService();