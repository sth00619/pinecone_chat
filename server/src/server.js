// server/src/server.js
require('dotenv').config();

const app = require('./app');
const pool = require('./config/database');
const { initializeRedis } = require('./config/redis');
const syncIntegration = require('./modules/syncIntegrationModule');
const learningEngine = require('./modules/learningEngine');
const WebSocketServer = require('./websocket/wsServer');
const authMiddleware = require('./middleware/authMiddleware');

const PORT = process.env.PORT || 3000;

// Initialize server
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/api-docs`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`📡 API Base: http://localhost:${PORT}/api`);
  
  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connected successfully');
    
    // Initialize Redis
    await initializeRedis();
    console.log('✅ Redis connected successfully');
    
    // Initialize WebSocket server
    if (process.env.NODE_ENV !== 'test') {
      const wsServer = new WebSocketServer(server);
      console.log('✅ WebSocket server initialized');
      
      // Store wsServer instance for global access
      app.set('wsServer', wsServer);
    }
    
    // Start sync integration and learning engine
    if (process.env.NODE_ENV !== 'test' && process.env.ENABLE_SYNC !== 'false') {
      // Start the sync integration module
      syncIntegration.startSync();
      console.log('✅ Sync integration module started');
      
      // The learning engine is started by syncIntegration
      console.log('✅ Learning engine started');
    }
    
    // Initialize Pinecone if enabled
    if (process.env.PINECONE_API_KEY && process.env.ENABLE_PINECONE !== 'false') {
      const pineconeDao = require('./dao/pineconeDao');
      await pineconeDao.initialize();
      console.log('✅ Pinecone initialized');
    }
    
  } catch (error) {
    console.error('❌ Server initialization error:', error);
    console.error('Please check your database and Redis connections');
  }
});

// Admin API routes for sync management
if (process.env.NODE_ENV !== 'test') {
  // Manual sync trigger
  app.post('/api/admin/sync/trigger', authMiddleware, async (req, res) => {
    try {
      const { type = 'full' } = req.body;
      
      // Simple admin check (improve this based on your auth system)
      if (!req.userId) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      console.log(`📡 Manual sync triggered by user ${req.userId}: ${type}`);
      const result = await syncIntegration.triggerManualSync(type);
      res.json(result);
    } catch (error) {
      console.error('Manual sync error:', error);
      res.status(500).json({ error: 'Sync failed', details: error.message });
    }
  });
  
  // Get sync statistics
  app.get('/api/admin/sync/stats', authMiddleware, async (req, res) => {
    try {
      const redis = require('./config/redis');
      const stats = await redis.get('sync:stats');
      
      if (stats) {
        res.json(JSON.parse(stats));
      } else {
        // Generate fresh stats
        const pineconeDao = require('./dao/pineconeDao');
        const knowledgeDao = require('./dao/knowledgeDao');
        
        const pineconeStats = await pineconeDao.getStats();
        const [localStats] = await pool.query(`
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
      }
    } catch (error) {
      console.error('Stats retrieval error:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });
  
  // Mount admin sync routes
  const adminSyncRoutes = require('./routes/adminSyncRoutes');
  app.use('/api/admin/sync', adminSyncRoutes);
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');
    
    // Check Redis
    const redis = require('./config/redis');
    await redis.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
        syncIntegration: process.env.ENABLE_SYNC !== 'false' ? 'active' : 'disabled',
        pinecone: process.env.ENABLE_PINECONE !== 'false' ? 'active' : 'disabled'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      console.log('HTTP server closed');
    });
    
    // Stop sync and learning processes
    if (process.env.ENABLE_SYNC !== 'false') {
      syncIntegration.stopSync();
      console.log('Sync integration stopped');
    }
    
    // Close database connections
    await pool.end();
    console.log('Database connections closed');
    
    // Close Redis connection
    const redis = require('./config/redis');
    await redis.quit();
    console.log('Redis connection closed');
    
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

module.exports = server;