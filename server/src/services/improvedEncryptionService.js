// server/src/services/improvedEncryptionService.js
const crypto = require('crypto');
const pool = require('../config/database');

class ImprovedEncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    
    // 마스터 키 관리 (실제로는 KMS 사용 권장)
    this.masterKey = this.deriveMasterKey();
    
    // 사용자별 키 캐시
    this.userKeyCache = new Map();
    
    // 키 로테이션 주기 (30일)
    this.keyRotationDays = 30;
  }

  // 마스터 키 유도
  deriveMasterKey() {
    const envKey = process.env.ENCRYPTION_MASTER_KEY;
    if (!envKey) {
      console.warn('⚠️ Using default master key - NOT FOR PRODUCTION!');
      return crypto.scryptSync('default-master-key', 'salt', 32);
    }
    return Buffer.from(envKey, 'hex');
  }

  // 사용자별 암호화 키 생성/조회
  async getUserEncryptionKey(userId) {
    // 캐시 확인
    if (this.userKeyCache.has(userId)) {
      return this.userKeyCache.get(userId);
    }

    // DB에서 사용자 키 조회
    const [rows] = await pool.query(
      'SELECT encryption_key, key_version, created_at FROM user_encryption_keys WHERE user_id = ? AND is_active = TRUE',
      [userId]
    );

    if (rows.length > 0) {
      const userKey = Buffer.from(rows[0].encryption_key, 'hex');
      
      // 키 로테이션 확인
      const keyAge = (Date.now() - new Date(rows[0].created_at)) / (1000 * 60 * 60 * 24);
      if (keyAge > this.keyRotationDays) {
        return await this.rotateUserKey(userId, rows[0].key_version);
      }
      
      this.userKeyCache.set(userId, userKey);
      return userKey;
    }

    // 새 사용자 키 생성
    return await this.createUserKey(userId);
  }

  // 사용자 키 생성
  async createUserKey(userId) {
    const userKey = crypto.randomBytes(32);
    const encryptedKey = this.encryptWithMasterKey(userKey);
    
    await pool.query(
      `INSERT INTO user_encryption_keys 
       (user_id, encryption_key, key_version, is_active) 
       VALUES (?, ?, 1, TRUE)`,
      [userId, encryptedKey.toString('hex')]
    );
    
    this.userKeyCache.set(userId, userKey);
    return userKey;
  }

  // 키 로테이션
  async rotateUserKey(userId, currentVersion) {
    const newKey = crypto.randomBytes(32);
    const encryptedKey = this.encryptWithMasterKey(newKey);
    
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // 기존 키 비활성화
      await connection.query(
        'UPDATE user_encryption_keys SET is_active = FALSE WHERE user_id = ?',
        [userId]
      );
      
      // 새 키 생성
      await connection.query(
        `INSERT INTO user_encryption_keys 
         (user_id, encryption_key, key_version, is_active) 
         VALUES (?, ?, ?, TRUE)`,
        [userId, encryptedKey.toString('hex'), currentVersion + 1]
      );
      
      // 기존 데이터 재암호화 (백그라운드에서 처리)
      this.scheduleReencryption(userId, currentVersion, newKey);
      
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
    this.userKeyCache.set(userId, newKey);
    return newKey;
  }

  // 마스터 키로 사용자 키 암호화
  encryptWithMasterKey(userKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    let encrypted = cipher.update(userKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    return Buffer.concat([iv, authTag, encrypted]);
  }

  // 개인정보 암호화 (개선된 버전)
  async encryptPersonalData(userId, dataType, plainText, metadata = {}) {
    try {
      // 사용자 키 가져오기
      const userKey = await this.getUserEncryptionKey(userId);
      
      // 암호화
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, userKey, iv);
      
      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // 메타데이터 암호화 (선택적)
      const encryptedMetadata = metadata ? 
        this.encryptMetadata(metadata, userKey) : null;
      
      // DB에 저장
      const [result] = await pool.query(
        `INSERT INTO user_personal_data 
         (user_id, data_type, data_key, encrypted_value, original_message, 
          iv, auth_tag, context, confidence_score, is_active) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          userId,
          dataType,
          metadata.key || dataType,
          encrypted,
          plainText.substring(0, 50) + '...', // 미리보기용
          iv.toString('hex'),
          authTag.toString('hex'),
          encryptedMetadata ? encryptedMetadata.toString('hex') : JSON.stringify(metadata),
          metadata.confidence || 0.95
        ]
      );
      
      // 암호화 로그
      await this.logEncryption(userId, dataType, result.insertId);
      
      return {
        id: result.insertId,
        encrypted: true,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt personal data');
    }
  }

  // 개인정보 복호화 (개선된 버전)
  async decryptPersonalData(encryptedData, userId) {
    try {
      // 사용자 키 가져오기
      const userKey = await this.getUserEncryptionKey(userId);
      
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        userKey,
        Buffer.from(encryptedData.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(encryptedData.auth_tag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted_value, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      // 복호화 로그
      await this.logDecryption(userId, encryptedData.id);
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      
      // 키 버전 불일치 가능성 확인
      if (error.message.includes('auth')) {
        throw new Error('Authentication failed - possible key version mismatch');
      }
      
      throw new Error('Failed to decrypt personal data');
    }
  }

  // 메타데이터 암호화
  encryptMetadata(metadata, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    
    const jsonStr = JSON.stringify(metadata);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'hex')
    ]);
  }

  // 일괄 암호화 (성능 최적화)
  async encryptBatch(userId, dataArray) {
    const userKey = await this.getUserEncryptionKey(userId);
    const results = [];
    
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      for (const data of dataArray) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, userKey, iv);
        
        let encrypted = cipher.update(data.value, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        const [result] = await connection.query(
          `INSERT INTO user_personal_data 
           (user_id, data_type, data_key, encrypted_value, 
            iv, auth_tag, context, is_active) 
           VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            userId,
            data.type,
            data.key,
            encrypted,
            iv.toString('hex'),
            authTag.toString('hex'),
            JSON.stringify(data.metadata || {})
          ]
        );
        
        results.push({
          id: result.insertId,
          type: data.type,
          key: data.key
        });
      }
      
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
    return results;
  }

  // 암호화/복호화 로그
  async logEncryption(userId, dataType, dataId) {
    await pool.query(
      `INSERT INTO encryption_logs 
       (user_id, action, data_type, data_id) 
       VALUES (?, 'encrypt', ?, ?)`,
      [userId, dataType, dataId]
    );
  }

  async logDecryption(userId, dataId) {
    await pool.query(
      `INSERT INTO encryption_logs 
       (user_id, action, data_id) 
       VALUES (?, 'decrypt', ?)`,
      [userId, dataId]
    );
  }

  // 재암호화 스케줄링
  scheduleReencryption(userId, oldVersion, newKey) {
    // 실제로는 큐 시스템 사용
    setImmediate(async () => {
      try {
        await this.reencryptUserData(userId, oldVersion, newKey);
      } catch (error) {
        console.error('Reencryption failed:', error);
      }
    });
  }

  // 사용자 데이터 재암호화
  async reencryptUserData(userId, oldVersion, newKey) {
    // 이전 키로 암호화된 데이터 조회
    const [rows] = await pool.query(
      `SELECT * FROM user_personal_data 
       WHERE user_id = ? AND key_version = ?`,
      [userId, oldVersion]
    );
    
    for (const row of rows) {
      try {
        // 이전 키로 복호화
        const decrypted = await this.decryptWithOldKey(row, userId, oldVersion);
        
        // 새 키로 재암호화
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, newKey, iv);
        
        let encrypted = cipher.update(decrypted, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        // 업데이트
        await pool.query(
          `UPDATE user_personal_data 
           SET encrypted_value = ?, iv = ?, auth_tag = ?, 
               key_version = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [encrypted, iv.toString('hex'), authTag.toString('hex'), 
           oldVersion + 1, row.id]
        );
      } catch (error) {
        console.error(`Failed to reencrypt data ${row.id}:`, error);
      }
    }
  }

  // 개인정보 완전 삭제
  async secureDelete(userId, dataId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // 데이터 조회
      const [rows] = await connection.query(
        'SELECT * FROM user_personal_data WHERE id = ? AND user_id = ?',
        [dataId, userId]
      );
      
      if (rows.length === 0) {
        throw new Error('Data not found');
      }
      
      // 암호화된 데이터를 랜덤 데이터로 덮어쓰기
      const randomData = crypto.randomBytes(rows[0].encrypted_value.length / 2);
      
      await connection.query(
        `UPDATE user_personal_data 
         SET encrypted_value = ?, is_active = FALSE, 
             deleted_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [randomData.toString('hex'), dataId]
      );
      
      // 삭제 로그
      await connection.query(
        `INSERT INTO deletion_logs 
         (user_id, data_id, data_type) 
         VALUES (?, ?, ?)`,
        [userId, dataId, rows[0].data_type]
      );
      
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 키 캐시 정리
  clearKeyCache(userId = null) {
    if (userId) {
      this.userKeyCache.delete(userId);
    } else {
      this.userKeyCache.clear();
    }
  }

  // 암호화 상태 확인
  async getEncryptionStats(userId) {
    const [stats] = await pool.query(
      `SELECT 
        COUNT(*) as total_encrypted,
        COUNT(DISTINCT data_type) as data_types,
        MIN(created_at) as first_encryption,
        MAX(created_at) as last_encryption,
        AVG(LENGTH(encrypted_value)) as avg_size
       FROM user_personal_data 
       WHERE user_id = ? AND is_active = TRUE`,
      [userId]
    );
    
    return stats[0];
  }
}

module.exports = ImprovedEncryptionService;