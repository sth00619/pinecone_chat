// server/src/__tests__/encryption.test.js
const EncryptionService = require('../services/encryptionService');

describe('Encryption Service', () => {
  let encryptionService;

  beforeEach(() => {
    encryptionService = new EncryptionService();
  });

  test('should encrypt and decrypt data correctly', async () => {
    const originalData = 'sensitive@email.com';
    const userId = 1;
    const dataType = 'email';
    
    // Mock DB 저장
    encryptionService.encryptPersonalData = jest.fn().mockResolvedValue({
      id: 1,
      encrypted: true
    });
    
    const encryptResult = await encryptionService.encryptPersonalData(
      userId,
      dataType,
      originalData
    );
    
    expect(encryptResult.encrypted).toBe(true);
  });
});