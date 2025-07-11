const express = require('express');
const pineconeDao = require('../dao/pineconeDao');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     PineconeKnowledge:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: 벡터 고유 ID
 *         question:
 *           type: string
 *           description: 질문
 *         answer:
 *           type: string
 *           description: 답변
 *         keywords:
 *           type: string
 *           description: 키워드 (쉼표로 구분)
 *         category:
 *           type: string
 *           description: 카테고리
 *         priority:
 *           type: number
 *           description: 우선순위
 *         score:
 *           type: number
 *           description: 검색 점수 (검색 결과에만 포함)
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/pinecone/knowledge:
 *   post:
 *     summary: 새로운 지식 추가
 *     description: Pinecone 벡터 DB에 새로운 지식을 추가합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - answer
 *               - keywords
 *             properties:
 *               question:
 *                 type: string
 *                 example: "서울과학기술대학교의 역사는?"
 *               answer:
 *                 type: string
 *                 example: "서울과학기술대학교는 1910년에 설립된..."
 *               keywords:
 *                 type: string
 *                 example: "역사, 설립, 1910년"
 *               category:
 *                 type: string
 *                 example: "학교소개"
 *               priority:
 *                 type: number
 *                 example: 10
 *     responses:
 *       201:
 *         description: 지식 추가 성공
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/knowledge', authMiddleware, async (req, res) => {
  try {
    const { question, answer, keywords, category = 'general', priority = 0 } = req.body;
    
    if (!question || !answer || !keywords) {
      return res.status(400).json({ error: 'question, answer, and keywords are required' });
    }
    
    const id = await pineconeDao.addKnowledge({
      question,
      answer,
      keywords,
      category,
      priority
    });
    
    res.status(201).json({ 
      message: 'Knowledge added successfully',
      id 
    });
  } catch (error) {
    console.error('Error adding knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/knowledge/batch:
 *   post:
 *     summary: 여러 지식 일괄 추가
 *     description: Pinecone 벡터 DB에 여러 지식을 한번에 추가합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - question
 *                     - answer
 *                     - keywords
 *                   properties:
 *                     question:
 *                       type: string
 *                     answer:
 *                       type: string
 *                     keywords:
 *                       type: string
 *                     category:
 *                       type: string
 *                     priority:
 *                       type: number
 *     responses:
 *       201:
 *         description: 일괄 추가 성공
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/knowledge/batch', authMiddleware, async (req, res) => {
  try {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }
    
    const ids = await pineconeDao.addKnowledgeBatch(items);
    
    res.status(201).json({ 
      message: `${ids.length} knowledge items added successfully`,
      ids 
    });
  } catch (error) {
    console.error('Error adding knowledge batch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/search:
 *   post:
 *     summary: 지식 검색
 *     description: 사용자 질문에 대한 답변을 검색합니다.
 *     tags: [Pinecone]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 example: "학교 역사에 대해 알려주세요"
 *               topK:
 *                 type: number
 *                 default: 5
 *                 example: 3
 *     responses:
 *       200:
 *         description: 검색 성공
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/search', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    const result = await pineconeDao.searchAnswer(query, topK);
    
    if (!result) {
      return res.json({ 
        message: 'No relevant answer found',
        result: null 
      });
    }
    
    res.json({ result });
  } catch (error) {
    console.error('Error searching knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/knowledge/{id}:
 *   get:
 *     summary: ID로 지식 조회
 *     description: 특정 ID의 지식 항목을 조회합니다.
 *     tags: [Pinecone]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 조회할 지식의 ID
 *     responses:
 *       200:
 *         description: 조회 성공
 *       404:
 *         description: 지식을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/knowledge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const knowledge = await pineconeDao.getKnowledgeById(id);
    
    if (!knowledge) {
      return res.status(404).json({ error: 'Knowledge not found' });
    }
    
    res.json({ knowledge });
  } catch (error) {
    console.error('Error fetching knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/knowledge/{id}:
 *   put:
 *     summary: 지식 업데이트
 *     description: 특정 ID의 지식 항목을 업데이트합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 업데이트할 지식의 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question:
 *                 type: string
 *               answer:
 *                 type: string
 *               keywords:
 *                 type: string
 *               category:
 *                 type: string
 *               priority:
 *                 type: number
 *     responses:
 *       200:
 *         description: 업데이트 성공
 *       404:
 *         description: 지식을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.put('/knowledge/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    await pineconeDao.updateKnowledge(id, updateData);
    
    res.json({ 
      message: 'Knowledge updated successfully',
      id 
    });
  } catch (error) {
    console.error('Error updating knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/knowledge/{id}:
 *   delete:
 *     summary: 지식 삭제
 *     description: 특정 ID의 지식 항목을 삭제합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 삭제할 지식의 ID
 *     responses:
 *       200:
 *         description: 삭제 성공
 *       500:
 *         description: 서버 오류
 */
router.delete('/knowledge/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pineconeDao.deleteKnowledge(id);
    
    res.json({ 
      message: 'Knowledge deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/stats:
 *   get:
 *     summary: Pinecone 인덱스 통계
 *     description: Pinecone 인덱스의 통계 정보를 조회합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 통계 조회 성공
 *       500:
 *         description: 서버 오류
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await pineconeDao.getStats();
    
    res.json({ stats });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/knowledge:
 *   get:
 *     summary: 모든 지식 조회
 *     description: Pinecone에 저장된 모든 지식을 조회합니다 (제한된 수).
 *     tags: [Pinecone]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 100
 *         description: 조회할 최대 항목 수
 *     responses:
 *       200:
 *         description: 조회 성공
 *       500:
 *         description: 서버 오류
 */
router.get('/knowledge', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    const knowledge = await pineconeDao.getAllKnowledge('', parseInt(limit));
    
    res.json({ 
      count: knowledge.length,
      knowledge 
    });
  } catch (error) {
    console.error('Error getting all knowledge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/pinecone/migrate:
 *   post:
 *     summary: 로컬 DB에서 Pinecone으로 마이그레이션
 *     description: 로컬 knowledge_base 테이블의 데이터를 Pinecone으로 마이그레이션합니다.
 *     tags: [Pinecone]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 마이그레이션 성공
 *       500:
 *         description: 서버 오류
 */
router.post('/migrate', authMiddleware, async (req, res) => {
  try {
    const knowledgeDao = require('../dao/knowledgeDao');
    
    // 로컬 DB에서 모든 지식 조회
    const categories = await knowledgeDao.getAllCategories();
    let totalMigrated = 0;
    
    for (const category of categories) {
      const items = await knowledgeDao.getByCategory(category.id);
      
      if (items.length > 0) {
        const pineconeItems = items.map(item => ({
          question: item.question,
          answer: item.answer,
          keywords: item.keywords,
          category: category.name,
          priority: item.priority || 0
        }));
        
        await pineconeDao.addKnowledgeBatch(pineconeItems);
        totalMigrated += items.length;
      }
    }
    
    res.json({ 
      message: `Migration completed. ${totalMigrated} items migrated to Pinecone.` 
    });
  } catch (error) {
    console.error('Error during migration:', error);
    res.status(500).json({ error: 'Migration failed' });
  }
});

module.exports = router;