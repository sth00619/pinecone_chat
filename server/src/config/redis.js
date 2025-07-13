// server/src/config/redis.js
const redis = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            console.error('Redis connection refused');
            return new Error('Redis connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis error:', err);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        console.log('Redis connection ended');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('Redis connection failed:', error);
      // Graceful fallback - continue without Redis
      this.client = new MockRedisClient();
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.isConnected) return false;
    try {
      if (ttl) {
        return await this.client.setEx(key, ttl, value);
      } else {
        return await this.client.set(key, value);
      }
    } catch (error) {
      console.error('Redis set error:', error);
      return false;
    }
  }

  async setex(key, ttl, value) {
    return await this.set(key, value, ttl);
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected) return false;
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }

  async flushdb() {
    if (!this.isConnected) return false;
    try {
      return await this.client.flushDb();
    } catch (error) {
      console.error('Redis flushdb error:', error);
      return false;
    }
  }
}

// Mock Redis client for fallback
class MockRedisClient {
  constructor() {
    this.cache = new Map();
    console.log('⚠️ Using in-memory cache fallback (Redis unavailable)');
  }

  async get(key) {
    const item = this.cache.get(key);
    if (item && item.expires && Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item ? item.value : null;
  }

  async set(key, value, ttl = null) {
    const item = { value };
    if (ttl) {
      item.expires = Date.now() + (ttl * 1000);
    }
    this.cache.set(key, item);
    return true;
  }

  async setex(key, ttl, value) {
    return await this.set(key, value, ttl);
  }

  async del(key) {
    return this.cache.delete(key);
  }

  async exists(key) {
    return this.cache.has(key);
  }

  async flushdb() {
    this.cache.clear();
    return true;
  }
}

// Singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;