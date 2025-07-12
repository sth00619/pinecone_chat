// server/src/schedulers/learningScheduler.js
const cron = require('node-cron');
const learningEngine = require('../services/learningEngine');

class LearningScheduler {
  constructor() {
    this.jobs = [];
  }

  start() {
    console.log('🚀 Starting learning scheduler...');

    // 매 30분마다 학습 프로세스 실행
    const learningJob = cron.schedule('*/30 * * * *', async () => {
      console.log('⏰ Running scheduled learning process...');
      await learningEngine.processLearningQueue();
    });

    // 매일 자정에 전체 분석 실행
    const dailyAnalysisJob = cron.schedule('0 0 * * *', async () => {
      console.log('🌙 Running daily analysis...');
      await learningEngine.analyzeQuestionPatterns();
      await learningEngine.optimizeAnswerPerformance();
    });

    this.jobs.push(learningJob, dailyAnalysisJob);
    
    console.log('✅ Learning scheduler started');
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    console.log('❌ Learning scheduler stopped');
  }
}

module.exports = new LearningScheduler();