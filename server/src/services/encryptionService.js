// server/src/services/EncryptionService.js
const crypto = require('crypto');
const pool = require('../config/database');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.masterKey = Buffer.from(process.env.ENCRYPTION_MASTER_KEY || crypto.randomBytes(32));
  }

  async encryptPersonalData(userId, dataType, plainText, context = {}) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // DB에 저장
    const [result] = await pool.query(
      `INSERT INTO user_personal_data 
       (user_id, data_type, encrypted_value, iv, auth_tag, context, confidence_score) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        dataType,
        encrypted,
        iv.toString('hex'),
        authTag.toString('hex'),
        JSON.stringify(context),
        0.95
      ]
    );
    
    return {
      id: result.insertId,
      encrypted: true
    };
  }

  async decryptPersonalData(encryptedData) {
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.masterKey,
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.auth_tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted_value, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async getUserPersonalData(userId, dataType = null) {
    let query = 'SELECT * FROM user_personal_data WHERE user_id = ?';
    const params = [userId];
    
    if (dataType) {
      query += ' AND data_type = ?';
      params.push(dataType);
    }
    
    const [rows] = await pool.query(query, params);
    
    // 복호화해서 반환
    const decryptedData = [];
    for (const row of rows) {
      try {
        const decrypted = await this.decryptPersonalData(row);
        decryptedData.push({
          id: row.id,
          dataType: row.data_type,
          value: decrypted,
          context: row.context,
          createdAt: row.created_at
        });
      } catch (error) {
        console.error('Decryption failed for row:', row.id, error);
      }
    }
    
    return decryptedData;
  }
}

module.exports = EncryptionService;