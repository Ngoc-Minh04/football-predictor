import { analyzeInjuriesAndContextWithAI } from '../ai/claudeAnalyzer.js';
import { predict } from '../models/predictor.js';
import { getDatabase, queryGet } from '../db/database.js';
import dotenv from 'dotenv';
dotenv.config();

async function runContextTest() {
  console.log('--- BẮT ĐẦU KIỂM THỬ AI-POWERED NEWS ANALYZER (HƯỚNG 2) ---');

  const homeTeam = 'France';
  const awayTeam = 'England';
  
  // Tin tức giả lập phức tạp
  const newsText = 'Pháp: Mbappe gặp chấn thương cơ đùi nghiêm trọng không thể ra sân, thủ môn chính Maignan bị sốt nhẹ. Anh: HLV mới Tuchel mang lại tinh thần hưng phấn cực lớn cho toàn đội, Kane đạt phong độ ghi bàn rất cao.';
  
  console.log(`\n📰 Tin tức giả định:\n"${newsText}"`);

  // 1. Phân tích bằng Gemini AI
  console.log('\n🧠 Đang gọi Gemini AI để định lượng tin tức...');
  const aiQuant = await analyzeInjuriesAndContextWithAI(newsText, homeTeam, awayTeam, true);
  
  console.log('\n📊 Kết quả định lượng từ AI:');
  console.log(`   -> Phạt tấn công Đội nhà (homeAttackPenalty): ${aiQuant.homeAttackPenalty * 100}%`);
  console.log(`   -> Phạt tấn công Đội khách (awayAttackPenalty): ${aiQuant.awayAttackPenalty * 100}%`);
  console.log(`   -> Phạt phòng ngự Đội nhà (homeDefensePenalty): ${aiQuant.homeDefensePenalty * 100}%`);
  console.log(`   -> Phạt phòng ngự Đội khách (awayDefensePenalty): ${aiQuant.awayDefensePenalty * 100}%`);
  console.log(`   -> Động lực Đội nhà (homeMotivation): ${aiQuant.homeMotivation}`);
  console.log(`   -> Động lực Đội khách (awayMotivation): ${aiQuant.awayMotivation}`);
  console.log(`   -> Lý giải từ AI: "${aiQuant.reasoning}"`);

  // 2. Chạy mô hình dự đoán thống kê so sánh
  const db = await getDatabase();
  const homeStats = await queryGet(db, "SELECT * FROM team_stats WHERE team_id = (SELECT id FROM teams WHERE name = 'France') LIMIT 1") || { goals_scored: 10, goals_conceded: 5, matches_played: 6, xG: 9.5, xGA: 5.2 };
  const awayStats = await queryGet(db, "SELECT * FROM team_stats WHERE team_id = (SELECT id FROM teams WHERE name = 'England') LIMIT 1") || { goals_scored: 12, goals_conceded: 4, matches_played: 6, xG: 11.2, xGA: 4.8 };

  // Kịch bản A: Không có tin tức (Mặc định)
  const predNormal = predict({
    homeStats,
    awayStats,
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeTeamId: 1,
    awayTeamId: 2,
    homeElo: 2080,
    awayElo: 2010,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
  });

  // Kịch bản B: Có tin tức (AI-Powered)
  const predAI = predict({
    homeStats,
    awayStats,
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeTeamId: 1,
    awayTeamId: 2,
    homeElo: 2080,
    awayElo: 2010,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
    injuryFactor: aiQuant, // Gửi kết quả định lượng AI vào
  });

  console.log('\n🔥 So sánh kết quả dự đoán:');
  console.log(`   [Kịch bản mặc định]`);
  console.log(`   -> Lambdas: Pháp: ${predNormal.lambdas.home} bàn | Anh: ${predNormal.lambdas.away} bàn`);
  console.log(`   -> Tỷ số dự báo: ${predNormal.score.home} - ${predNormal.score.away}`);
  console.log(`   -> 1X2 Probs: Pháp thắng: ${Math.round(predNormal.result.home*100)}% | Hòa: ${Math.round(predNormal.result.draw*100)}% | Anh thắng: ${Math.round(predNormal.result.away*100)}%`);

  console.log(`\n   [Kịch bản có AI News Analyzer]`);
  console.log(`   -> Lambdas: Pháp: ${predAI.lambdas.home} bàn | Anh: ${predAI.lambdas.away} bàn`);
  console.log(`   -> Tỷ số dự báo: ${predAI.score.home} - ${predAI.score.away}`);
  console.log(`   -> 1X2 Probs: Pháp thắng: ${Math.round(predAI.result.home*100)}% | Hòa: ${Math.round(predAI.result.draw*100)}% | Anh thắng: ${Math.round(predAI.result.away*100)}%`);

  const isLambdaHomeReduced = predAI.lambdas.home < predNormal.lambdas.home;
  const isLambdaAwayIncreased = predAI.lambdas.away > predNormal.lambdas.away;

  if (isLambdaHomeReduced && isLambdaAwayIncreased) {
    console.log('\n✅ KIỂM THỬ THÀNH CÔNG: Sức mạnh tấn công Pháp giảm và sức mạnh ghi bàn Anh tăng lên hoàn hảo theo đúng tin tức!');
  } else {
    console.log('\n❌ KIỂM THỬ THẤT BẠI: Biến động lambda không khớp logic.');
  }
}

runContextTest().catch(err => console.error(err));
