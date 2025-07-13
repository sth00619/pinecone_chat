// server/src/__tests__/personalDataDetection.test.js
const PersonalDataDetector = require('../services/personalDataDetector');

describe('Personal Data Detection', () => {
  let detector;

  beforeEach(() => {
    detector = new PersonalDataDetector();
  });

  test('should detect email addresses', async () => {
    const text = '제 이메일은 test@example.com 입니다';
    const result = await detector.detect(text);
    
    expect(result.hasPersonalData).toBe(true);
    expect(result.detectedTypes).toContain('email');
    expect(result.data.email).toBe('test@example.com');
  });

  test('should detect Korean phone numbers', async () => {
    const text = '연락처: 010-1234-5678';
    const result = await detector.detect(text);
    
    expect(result.hasPersonalData).toBe(true);
    expect(result.detectedTypes).toContain('phone');
    expect(result.data.phone).toBe('010-1234-5678');
  });

  test('should detect multiple personal data types', async () => {
    const text = '이메일 john@example.com, 전화 010-9876-5432';
    const result = await detector.detect(text);
    
    expect(result.hasPersonalData).toBe(true);
    expect(result.detectedTypes).toHaveLength(2);
    expect(result.detectedTypes).toContain('email');
    expect(result.detectedTypes).toContain('phone');
  });

  test('should not detect personal data in normal text', async () => {
    const text = '안녕하세요. 오늘 날씨가 좋네요.';
    const result = await detector.detect(text);
    
    expect(result.hasPersonalData).toBe(false);
    expect(result.detectedTypes).toHaveLength(0);
  });
});