import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, queryGet, queryRun, queryAll } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';
import { runMigrations } from '../db/migrations.js';

async function testDynamicDecay() {
  console.log('=== TEST 1: KIỂM TRA DYNAMIC DECAY (HƯỚNG C) ===');
  
  // Tạo danh sách trận đấu giả lập trong quá khứ để test decay
  // Khoảng cách ngày tăng dần: 5 ngày trước, 15 ngày trước, 30 ngày trước, 60 ngày trước
  const matchDate = '2026-06-20';
  const targetDate = new Date(matchDate);
  const homeTeamId = 1; // Team ID bất kỳ
  
  const dummyMatches = [
    { date: '2026-06-15', league: 'WC', home_team_id: homeTeamId, score_home: 2, score_away: 1, home_elo: 1600, away_elo: 1500 }, // 5 ngày trước
    { date: '2026-06-05', league: 'WC', home_team_id: homeTeamId, score_home: 1, score_away: 0, home_elo: 1650, away_elo: 1550 }, // 15 ngày trước
    { date: '2026-05-21', league: 'PL', home_team_id: homeTeamId, score_home: 3, score_away: 2, home_elo: 1700, away_elo: 1500 }, // 30 ngày trước
    { date: '2026-04-21', league: 'FR', home_team_id: homeTeamId, score_home: 0, score_away: 1, home_elo: 1600, away_elo: 1600 }, // 60 ngày trước (Friendly / giải phụ)
  ];

  // Hàm tính trọng số để in ra màn hình kiểm chứng
  function printWeightsForLeague(targetLeague) {
    console.log(`\nTrường hợp targetLeague = "${targetLeague}":`);
    const decay = 0.0045; // default decay
    
    dummyMatches.forEach((m, idx) => {
      const diffMs = targetDate - new Date(m.date);
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      
      let tierFactor = 1.0;
      if (targetLeague) {
        if (m.league === targetLeague) {
          tierFactor = 0.5; // Tầng 1: Cùng giải (World Cup), decay chậm
        } else if (['PL', 'EC', 'CL', 'PD', 'BL1', 'SA', 'FL1'].includes(m.league)) {
          tierFactor = 1.0; // Tầng 2: Giải lớn khác
        } else {
          tierFactor = 2.0; // Tầng 3: Trận giao hữu / giải phụ, decay cực nhanh
        }
      }
      
      const w = Math.exp(-decay * tierFactor * diffDays);
      console.log(`- Trận ${idx+1} (${m.league}, cách ${diffDays} ngày): TierFactor = ${tierFactor} -> Weight = ${w.toFixed(4)}`);
    });
  }

  printWeightsForLeague('WC'); // Target giải đấu là World Cup
  printWeightsForLeague('PL'); // Target giải đấu là Premier League
}

async function testCorrectScoreValueBets() {
  console.log('\n=== TEST 2: KIỂM TRA CORRECT SCORE VALUE BET DETECTOR (HƯỚNG B) ===');
  
  const db = await getDatabase();
  
  // Lấy hoặc chèn 2 đội bóng để test
  let homeTeam = await queryGet(db, "SELECT * FROM teams WHERE name = 'France' OR id = 1");
  let awayTeam = await queryGet(db, "SELECT * FROM teams WHERE name = 'England' OR id = 2");
  
  if (!homeTeam) {
    await queryRun(db, "INSERT INTO teams (id, name, elo_rating) VALUES (1, 'France', 2080)");
    homeTeam = { id: 1, name: 'France', elo_rating: 2080 };
  }
  if (!awayTeam) {
    await queryRun(db, "INSERT INTO teams (id, name, elo_rating) VALUES (2, 'England', 2010)");
    awayTeam = { id: 2, name: 'England', elo_rating: 2010 };
  }

  // Đảm bảo có trận đấu trong bảng matches để lấy matchId
  let match = await queryGet(db, "SELECT id FROM matches WHERE home_team_id = ? AND away_team_id = ?", [homeTeam.id, awayTeam.id]);
  let matchId;
  if (!match) {
    await queryRun(db, "INSERT INTO matches (home_team_id, away_team_id, league, status, date, season) VALUES (?, ?, 'WC', 'SCHEDULED', '2026-06-20', 2026)", [homeTeam.id, awayTeam.id]);
    match = await queryGet(db, "SELECT id FROM matches WHERE home_team_id = ? AND away_team_id = ?", [homeTeam.id, awayTeam.id]);
  }
  matchId = match.id;
  console.log(`🎯 Match ID trong CSDL: ${matchId}`);

  // Chèn tỷ lệ Correct Score giả lập vào odds_cache
  // Tỷ lệ cược nhà cái cho một số tỷ số:
  // 1-0: odd = 7.0
  // 2-0: odd = 9.0
  // 2-1: odd = 8.5
  // 1-1: odd = 6.0
  // 0-0: odd = 11.0
  // 0-1: odd = 12.0
  const mockCorrectScoreOdds = {
    "1-0": 7.0,
    "2-0": 9.0,
    "2-1": 8.5,
    "1-1": 6.0,
    "0-0": 11.0,
    "0-1": 12.0
  };

  // Lưu mock odds vào DB
  await queryRun(db, `
    INSERT OR REPLACE INTO odds_cache (
      match_id, home_prob, draw_prob, away_prob, over25_prob, under25_prob, correct_score_odds, fetched_at
    ) VALUES (?, 0.45, 0.30, 0.25, 0.48, 0.52, ?, datetime('now'))
  `, [matchId, JSON.stringify(mockCorrectScoreOdds)]);
  
  console.log('✅ Đã lưu tỷ lệ Correct Score giả lập vào `odds_cache`.');

  // Chạy logic dự đoán tương tự controller
  const homeStats = { goals_scored: 10, goals_conceded: 5, matches_played: 6, xG: 9.5, xGA: 5.2 };
  const awayStats = { goals_scored: 12, goals_conceded: 4, matches_played: 6, xG: 11.2, xGA: 4.8 };

  const prediction = predict({
    homeStats,
    awayStats,
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeElo: homeTeam.elo_rating,
    awayElo: awayTeam.elo_rating,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    situationalFactors: {},
    h2hAvgGoals: 0,
    homeRestDays: 5,
    awayRestDays: 5,
    homeWinRate: 0.6,
    matchDate: '2026-06-20',
    isNeutral: true,
    targetLeague: 'WC',
  });

  // Tải odds từ Bookmaker
  const blend = await blendWithBookmaker(prediction.result, prediction.overUnder, matchId, db, prediction.confidence, true);
  
  if (blend.blended) {
    console.log('✅ blendWithBookmaker thành công. Tải được Correct Score odds.');
  } else {
    console.log('❌ blendWithBookmaker không lấy được odds.');
  }

  const activeCorrectScoreOdds = blend.correctScoreOdds;
  
  // Calibrate score matrix
  const calibratedMatrix = calibrateMatrixIPF(prediction.scoreMatrix, blend.result, blend.overUnder, null);
  
  // Tính toán Value Bets
  const valueBets = [];
  if (activeCorrectScoreOdds) {
    console.log('\n--- Tính toán Expected Value (+EV) cho các tỷ số ---');
    for (const scoreKey in activeCorrectScoreOdds) {
      const parts = scoreKey.split('-');
      if (parts.length === 2) {
        const hG = parseInt(parts[0]);
        const aG = parseInt(parts[1]);
        if (hG < calibratedMatrix.length && aG < calibratedMatrix[hG].length) {
          const prob = calibratedMatrix[hG][aG];
          const odd = parseFloat(activeCorrectScoreOdds[scoreKey]);
          if (prob > 0 && odd > 1) {
            const ev = prob * odd - 1;
            console.log(`Tỷ số ${scoreKey}: Xác suất model = ${(prob*100).toFixed(2)}%, Odd nhà cái = ${odd} -> EV = ${(ev*100).toFixed(2)}%`);
            if (ev > 0) {
              valueBets.push({
                score: scoreKey,
                odds: odd,
                prob: Math.round(prob * 1000) / 1000,
                ev: Math.round(ev * 100) / 100
              });
            }
          }
        }
      }
    }
    valueBets.sort((a, b) => b.ev - a.ev);
  }

  const top3 = valueBets.slice(0, 3);
  console.log('\n--- TOP 3 TỶ SỐ VÀNG (+EV) ---');
  if (top3.length === 0) {
    console.log('Không tìm thấy tỷ số +EV nào.');
  } else {
    top3.forEach((bet, i) => {
      console.log(`${i+1}. Tỷ số ${bet.score} | Odd: ${bet.odds} | Xác suất: ${(bet.prob*100).toFixed(1)}% | Expected Value (+EV): +${Math.round(bet.ev * 100)}%`);
    });
  }
}

async function run() {
  try {
    await runMigrations();
    await testDynamicDecay();
    await testCorrectScoreValueBets();
  } catch (err) {
    console.error(err);
  }
}

run();
