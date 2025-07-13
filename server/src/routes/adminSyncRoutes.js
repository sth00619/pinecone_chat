// server/src/routes/adminSyncRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const syncIntegration = require('../modules/syncIntegrationModule');
const knowledgeDao = require('../dao/knowledgeDao');
const learningDao = require('../dao/learningDao');
const redis = require('../config/redis');

// Middleware to check admin role (implement according to your auth system)
const adminMiddleware = (req, res, next) => {
  // TODO: Check if user has admin role
  // For now, just check if authenticated
  if (req.userId) {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

/**
 * @swagger
 * /api/admin/sync/trigger:
 *   post:
 *     summary: Trigger manual sync
 *     description: Manually trigger synchronization between Pinecone and RDBMS
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [full, pinecone-to-rdbms, rdbms-to-pinecone, cache-cleanup]
 *                 default: full
 */
router.post('/trigger', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { type = 'full' } = req.body;
    const result = await syncIntegration.triggerManualSync(type);
    res.json(result);
  } catch (error) {
    console.error('Manual sync error:', error);
    res.status(500).json({ error: 'Sync failed', details: error.message });
  }
});

/**
 * @swagger
 * /api/admin/sync/stats:
 *   get:
 *     summary: Get sync statistics
 *     description: Retrieve synchronization statistics between Pinecone and RDBMS
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/stats', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const cachedStats = await redis.get('sync:stats');
    const stats = cachedStats ? JSON.parse(cachedStats) : null;
    
    if (!stats) {
      // Generate fresh stats if cache is empty
      const pineconeStats = await require('../dao/pineconeDao').getStats();
      const [localStats] = await knowledgeDao.pool.query(`
        SELECT 
          COUNT(DISTINCT kb.id) as total_knowledge,
          COUNT(DISTINCT kps.id) as synced_count,
          AVG(kps.performance_score) as avg_performance
        FROM knowledge_base kb
        LEFT JOIN knowledge_pinecone_sync kps ON kb.id = kps.knowledge_base_id
        WHERE kb.is_active = TRUE
      `);
      
      res.json({
        timestamp: new Date().toISOString(),
        pinecone: pineconeStats,
        local: localStats[0],
        cached: false
      });
    } else {
      res.json({ ...stats, cached: true });
    }
  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * @swagger
 * /api/admin/sync/learning-queue:
 *   get:
 *     summary: Get learning queue status
 *     description: Retrieve pending items in the learning queue
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/learning-queue', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const pendingItems = await learningDao.getPendingLearningItems(20);
    const [queueStats] = await knowledgeDao.pool.query(`
      SELECT 
        processing_status,
        COUNT(*) as count
      FROM learning_queue
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY processing_status
    `);
    
    res.json({
      pending: pendingItems.length,
      recentStats: queueStats,
      items: pendingItems.slice(0, 10) // First 10 items
    });
  } catch (error) {
    console.error('Learning queue error:', error);
    res.status(500).json({ error: 'Failed to get learning queue' });
  }
});

/**
 * @swagger
 * /api/admin/sync/pinecone-usage:
 *   get:
 *     summary: Get Pinecone usage statistics
 *     description: Retrieve usage statistics for Pinecone knowledge items
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pinecone-usage', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const usageStats = await knowledgeDao.getPineconeUsageStats();
    res.json({
      totalItems: usageStats.length,
      stats: usageStats.slice(0, 20) // Top 20 most used
    });
  } catch (error) {
    console.error('Pinecone usage error:', error);
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

/**
 * @swagger
 * /api/admin/sync/personal-data-logs:
 *   get:
 *     summary: Get personal data detection logs
 *     description: Retrieve recent personal data detection logs
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/personal-data-logs', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const [logs] = await knowledgeDao.pool.query(`
      SELECT 
        pdl.*,
        m.content as message_preview
      FROM personal_data_logs pdl
      LEFT JOIN messages m ON pdl.message_id = m.id
      ORDER BY pdl.created_at DESC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), parseInt(offset)]);
    
    res.json({
      logs,
      total: logs.length
    });
  } catch (error) {
    console.error('Personal data logs error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * @swagger
 * /api/admin/sync/question-patterns:
 *   get:
 *     summary: Get question pattern analysis
 *     description: Retrieve frequently asked questions and their performance
 *     tags: [Admin - Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/question-patterns', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const patterns = await learningDao.getQuestionPatterns(30); // Last 30 days
    
    res.json({
      totalPatterns: patterns.length,
      lowSatisfaction: patterns.filter(p => p.avg_feedback < 3).length,
      highFrequency: patterns.filter(p => p.frequency > 10).length,
      patterns: patterns.slice(0, 50) // Top 50 patterns
    });
  } catch (error) {
    console.error('Question patterns error:', error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

module.exports = router;