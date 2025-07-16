// server/src/services/ScheduleService.js
const EncryptionService = require('./encryptionService');

class ScheduleService {
  constructor() {
    this.encryptionService = new EncryptionService();
    
    // 월 이름 매핑
    this.monthMappings = {
      '1월': 1, '2월': 2, '3월': 3, '4월': 4, '5월': 5, '6월': 6,
      '7월': 7, '8월': 8, '9월': 9, '10월': 10, '11월': 11, '12월': 12,
      '일월': 1, '이월': 2, '삼월': 3, '사월': 4, '오월': 5, '유월': 6,
      '칠월': 7, '팔월': 8, '구월': 9, '시월': 10, '십일월': 11, '십이월': 12,
      'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
      'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
    };

    // 월별 한국어 이름
    this.monthNames = {
      1: '1월', 2: '2월', 3: '3월', 4: '4월', 5: '5월', 6: '6월',
      7: '7월', 8: '8월', 9: '9월', 10: '10월', 11: '11월', 12: '12월'
    };
  }

  // 메시지에서 월 정보 추출 (개선된 버전)
  extractMonthFromMessage(message) {
    console.log(`🔍 Extracting month from message: "${message}"`);
    
    // 숫자 + 월 패턴 (우선순위 높음)
    const monthPattern = /(\d{1,2})월/g;
    const matches = [...message.matchAll(monthPattern)];
    
    if (matches.length > 0) {
      const monthNum = parseInt(matches[0][1]);
      if (monthNum >= 1 && monthNum <= 12) {
        console.log(`✅ Found month: ${monthNum}`);
        return monthNum;
      }
    }

    // 직접적인 월 표현 찾기
    for (const [monthStr, monthNum] of Object.entries(this.monthMappings)) {
      if (message.includes(monthStr)) {
        console.log(`✅ Found month by mapping: ${monthStr} -> ${monthNum}`);
        return monthNum;
      }
    }

    console.log(`❌ No month found in message`);
    return null;
  }

  // 일정 조회 유형 분석
  analyzeScheduleQuery(message) {
    const queryPatterns = {
      monthly: /(.*월).*일정|일정.*(.*월)/,
      all: /(모든|전체|나의|내).*일정/,
      today: /(오늘|금일).*일정/,
      tomorrow: /(내일|명일).*일정/,
      thisWeek: /(이번주|이번 주).*일정/,
      nextWeek: /(다음주|다음 주).*일정/,
      upcoming: /(앞으로|예정|다음).*일정/
    };

    for (const [type, pattern] of Object.entries(queryPatterns)) {
      if (pattern.test(message)) {
        return type;
      }
    }

    return 'general';
  }

  // 월별 일정 조회
  async getMonthlySchedules(userId, month) {
    try {
      const schedules = await this.encryptionService.getScheduleData(userId, month);
      
      if (schedules.length === 0) {
        return `${this.monthNames[month]}에 등록된 일정이 없습니다.`;
      }
      
      return this.formatMonthlySchedules(schedules, month);
    } catch (error) {
      console.error(`Error getting schedules for month ${month}:`, error);
      return `${this.monthNames[month]} 일정을 불러오는 중 오류가 발생했습니다.`;
    }
  }

  // 모든 일정 조회
  async getAllSchedules(userId, limit = 20) {
    try {
      const schedules = await this.encryptionService.getScheduleData(userId);
      
      if (schedules.length === 0) {
        return "등록된 일정이 없습니다.";
      }
      
      return this.formatAllSchedules(schedules.slice(0, limit));
    } catch (error) {
      console.error('Error getting all schedules:', error);
      return "일정을 불러오는 중 오류가 발생했습니다.";
    }
  }

  // 다가오는 일정 조회
  async getUpcomingSchedules(userId, days = 7) {
    try {
      const allSchedules = await this.encryptionService.getScheduleData(userId);
      const upcomingSchedules = this.filterUpcomingSchedules(allSchedules, days);
      
      if (upcomingSchedules.length === 0) {
        return `앞으로 ${days}일간 예정된 일정이 없습니다.`;
      }
      
      return this.formatUpcomingSchedules(upcomingSchedules, days);
    } catch (error) {
      console.error('Error getting upcoming schedules:', error);
      return "다가오는 일정을 불러오는 중 오류가 발생했습니다.";
    }
  }

  // 월별 일정 포맷팅
  formatMonthlySchedules(schedules, month) {
    const monthName = this.monthNames[month];
    let result = `🗓️ ${monthName} 일정:\n\n`;
    
    // 날짜별로 그룹화
    const groupedSchedules = this.groupSchedulesByDate(schedules);
    
    Object.keys(groupedSchedules).sort().forEach(dateKey => {
      if (dateKey !== '날짜 미정') {
        try {
          const date = new Date(dateKey);
          const day = date.getDate();
          const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
          const weekday = weekdays[date.getDay()];
          result += `📅 ${month}월 ${day}일 (${weekday})\n`;
        } catch {
          result += `📅 ${dateKey}\n`;
        }
      } else {
        result += `📅 ${dateKey}\n`;
      }
      
      groupedSchedules[dateKey].forEach((schedule, index) => {
        const timeStr = schedule.time ? ` (${schedule.time})` : '';
        result += `${index + 1}. ${schedule.title}${timeStr}\n`;
      });
      result += '\n';
    });
    
    return result;
  }

  // 전체 일정 포맷팅
  formatAllSchedules(schedules) {
    let result = "📋 전체 일정 목록:\n\n";
    
    const groupedByMonth = {};
    schedules.forEach(schedule => {
      const month = this.extractMonth(schedule);
      const monthKey = month ? this.monthNames[month] : '날짜 미정';
      
      if (!groupedByMonth[monthKey]) {
        groupedByMonth[monthKey] = [];
      }
      groupedByMonth[monthKey].push(schedule);
    });
    
    Object.keys(groupedByMonth).sort().forEach(monthKey => {
      result += `📅 ${monthKey}\n`;
      groupedByMonth[monthKey].forEach((schedule, index) => {
        const timeStr = schedule.time ? ` (${schedule.time})` : '';
        const dateStr = schedule.date ? ` - ${schedule.date}` : '';
        result += `${index + 1}. ${schedule.title}${dateStr}${timeStr}\n`;
      });
      result += '\n';
    });
    
    return result;
  }

  // 다가오는 일정 포맷팅
  formatUpcomingSchedules(schedules, days) {
    let result = `⏰ 앞으로 ${days}일간의 일정:\n\n`;
    
    schedules.forEach((schedule, index) => {
      const timeStr = schedule.time ? ` (${schedule.time})` : '';
      const dateStr = schedule.date ? ` - ${schedule.date}` : '';
      result += `${index + 1}. ${schedule.title}${dateStr}${timeStr}\n`;
    });
    
    return result;
  }

  // 날짜별 그룹화
  groupSchedulesByDate(schedules) {
    const grouped = {};
    
    schedules.forEach(schedule => {
      const dateKey = schedule.date || '날짜 미정';
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(schedule);
    });
    
    return grouped;
  }

  // 다가오는 일정 필터링
  filterUpcomingSchedules(schedules, days) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + days);
    
    return schedules.filter(schedule => {
      if (!schedule.date) return false;
      
      try {
        const scheduleDate = new Date(schedule.date);
        return scheduleDate >= now && scheduleDate <= futureDate;
      } catch {
        return false;
      }
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  // 월 추출 (EncryptionService와 동일)
  extractMonth(schedule) {
    if (schedule.date) {
      try {
        const date = new Date(schedule.date);
        return date.getMonth() + 1;
      } catch (error) {
        const monthMatch = schedule.title.match(/(\d{1,2})월/);
        if (monthMatch) {
          return parseInt(monthMatch[1]);
        }
      }
    }
    
    if (schedule.createdAt) {
      const date = new Date(schedule.createdAt);
      return date.getMonth() + 1;
    }
    
    return null;
  }

  // 메인 일정 조회 함수
  async handleScheduleQuery(message, userId) {
    try {
      const queryType = this.analyzeScheduleQuery(message);
      const month = this.extractMonthFromMessage(message);
      
      console.log(`Schedule query - Type: ${queryType}, Month: ${month}`);
      
      switch (queryType) {
        case 'monthly':
          if (month) {
            return await this.getMonthlySchedules(userId, month);
          } else {
            return "어떤 월의 일정을 확인하고 싶으신지 명확히 말씀해 주세요.";
          }
          
        case 'all':
          return await this.getAllSchedules(userId);
          
        case 'upcoming':
          return await this.getUpcomingSchedules(userId);
          
        case 'today':
          return await this.getTodaySchedules(userId);
          
        case 'tomorrow':
          return await this.getTomorrowSchedules(userId);
          
        case 'thisWeek':
          return await this.getThisWeekSchedules(userId);
          
        case 'nextWeek':
          return await this.getNextWeekSchedules(userId);
          
        default:
          // 월이 명시된 경우 월별 조회
          if (month) {
            return await this.getMonthlySchedules(userId, month);
          }
          // 그렇지 않으면 전체 일정 조회
          return await this.getAllSchedules(userId, 10);
      }
    } catch (error) {
      console.error('Error handling schedule query:', error);
      return "일정 조회 중 오류가 발생했습니다.";
    }
  }

  // 오늘 일정
  async getTodaySchedules(userId) {
    const today = new Date().toISOString().split('T')[0];
    // 구현 필요
    return "오늘 일정 조회 기능을 구현 중입니다.";
  }

  // 내일 일정
  async getTomorrowSchedules(userId) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // 구현 필요
    return "내일 일정 조회 기능을 구현 중입니다.";
  }

  // 이번주 일정
  async getThisWeekSchedules(userId) {
    // 구현 필요
    return "이번주 일정 조회 기능을 구현 중입니다.";
  }

  // 다음주 일정
  async getNextWeekSchedules(userId) {
    // 구현 필요
    return "다음주 일정 조회 기능을 구현 중입니다.";
  }
}

module.exports = ScheduleService;