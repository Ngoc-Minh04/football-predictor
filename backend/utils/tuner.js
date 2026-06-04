import fs from 'fs';
import path from 'path';
import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { getDixonColesStrengths } from './dixonColesSolver.js';

// Random float between min and max
function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

// Random pick from array
function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function runTuner(iterations = 350) {
  console.log('🤖 [Tuner] Khởi động hệ thống tự động tối ưu hóa siêu tham số...');
  const db = await getDatabase();

  // Lấy 100 trận đấu kết thúc gần nhất để huấn luyện
  const rawMatches = await queryAll(db,
    `SELECT m.*, ht.name as home_name, at.name as away_name,
            ht.elo_rating as home_elo, at.elo_rating as away_elo
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
     ORDER BY m.date DESC LIMIT 100`
  );

  if (rawMatches.length === 0) {
    console.error('❌ [Tuner] Không tìm thấy trận đấu nào đã kết thúc trong database để tối ưu hóa.');
    process.exit(1);
  }

  console.log(`📦 [Tuner] Đang chuẩn bị trước dữ liệu cho ${rawMatches.length} trận đấu (Pre-fetching)...`);
  const preparedMatches = [];

  for (let idx = 0; idx < rawMatches.length; idx++) {
    const m = rawMatches[idx];
    const matchDate = m.date;
    const homeId = m.home_team_id;
    const awayId = m.away_team_id;

    const leagueAvgHomeRow = await queryGet(db,
      `SELECT AVG(CAST(score_home AS REAL)) as avg
       FROM matches
       WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
      [m.league, matchDate, m.season]
    );
    const leagueAvgAwayRow = await queryGet(db,
      `SELECT AVG(CAST(score_away AS REAL)) as avg
       FROM matches
       WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
      [m.league, matchDate, m.season]
    );
    const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
    const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

    const h2hMatches = await queryAll(db,
      `SELECT score_home, score_away FROM matches
       WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
         AND date < ?
       ORDER BY date DESC LIMIT 5`,
      [homeId, awayId, awayId, homeId, matchDate]
    );
    const h2hRecentResults = h2hMatches.map(hm => ({ homeGoals: hm.score_home, awayGoals: hm.score_away }));

    const homeRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE (home_team_id = ? OR away_team_id = ?)
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
         AND date < ?
       ORDER BY date DESC LIMIT 12`,
      [homeId, homeId, matchDate]
    );
    const awayRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE (home_team_id = ? OR away_team_id = ?)
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
         AND date < ?
       ORDER BY date DESC LIMIT 12`,
      [awayId, awayId, matchDate]
    );

    const homeHomeRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE home_team_id = ?
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
         AND date < ?
       ORDER BY date DESC LIMIT 6`,
      [homeId, matchDate]
    );
    const awayAwayRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE away_team_id = ?
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
         AND date < ?
       ORDER BY date DESC LIMIT 6`,
      [awayId, matchDate]
    );

    const homeStats = await queryGet(db,
      'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
      [homeId, m.season]
    ) || { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 0, xGA: 0 };

    const awayStats = await queryGet(db,
      'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
      [awayId, m.season]
    ) || { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 0, xGA: 0 };

    let dixonColesStrengths = null;
    try {
      dixonColesStrengths = await getDixonColesStrengths(m.league, m.season, matchDate);
    } catch (_) {}

    preparedMatches.push({
      m,
      homeStats,
      awayStats,
      homeRecentMatches,
      awayRecentMatches,
      homeHomeRecentMatches,
      awayAwayRecentMatches,
      leagueAvgHome,
      leagueAvgAway,
      h2hRecentResults,
      dixonColesStrengths,
    });
  }

  console.log('✅ [Tuner] Nạp dữ liệu hoàn tất. Bắt đầu Random Search...');

  let bestScoreAcc = -1;
  let best1X2Acc = -1;
  let bestConfig = null;

  // Cấu hình mặc định để so sánh
  const baselineConfig = {
    decay: 0.0045,
    bivariateWeight: 0.70,
    nbR: 2.0,
    mleWeight: 0.20,
    rollingWeight: 0.60,
    xgWeight: 0.20,
    rollingWeightNonDC: 0.55,
    xgWeightNonDC: 0.20,
    meanWeightNonDC: 0.25,
    eloWeight: 0.15,
    homeAdvFactor: 0.97,
    drawBoostMax: 0.0
  };

  // Đánh giá baseline trước
  let baselineScoreOk = 0;
  let baseline1X2Ok = 0;
  for (const item of preparedMatches) {
    const pred = predict({
      ...item,
      homeTeamId: item.m.home_team_id,
      awayTeamId: item.m.away_team_id,
      homeElo: item.m.home_elo || 1500,
      awayElo: item.m.away_elo || 1500,
      matchDate: item.m.date,
      ...baselineConfig
    });
    if (item.m.score_home === pred.score.home && item.m.score_away === pred.score.away) {
      baselineScoreOk++;
    }
    const act1X2 = item.m.score_home > item.m.score_away ? 'home' : (item.m.score_home < item.m.score_away ? 'away' : 'draw');
    const pred1X2 = pred.result.home > pred.result.draw && pred.result.home > pred.result.away ? 'home' : (pred.result.away > pred.result.home && pred.result.away > pred.result.draw ? 'away' : 'draw');
    if (act1X2 === pred1X2) baseline1X2Ok++;
  }
  console.log(`📊 [Tuner] Baseline (Mặc định): Tỉ số = ${baselineScoreOk}/${rawMatches.length} (${(baselineScoreOk/rawMatches.length*100).toFixed(1)}%) | 1X2 = ${baseline1X2Ok}/${rawMatches.length} (${(baseline1X2Ok/rawMatches.length*100).toFixed(1)}%)`);

  // Bắt đầu tìm kiếm tham số tối ưu
  for (let iter = 0; iter < iterations; iter++) {
    if (iter > 0 && iter % 50 === 0) {
      console.log(`   - Tiến trình: Chạy xong ${iter}/${iterations} cấu hình...`);
    }

    // Sinh ngẫu nhiên tham số
    const decay = randomIn(0.002, 0.008);
    const bivariateWeight = randomIn(0.40, 0.85);
    const nbR = randomIn(1.0, 4.0);
    const mleWeight = randomIn(0.05, 0.35);
    const rollingWeight = randomIn(0.40, 0.75);
    const xgWeight = randomIn(0.10, 0.35);
    
    // Tinh chỉnh weights cho Dixon-Coles
    const rollingWeightNonDC = randomIn(0.40, 0.70);
    const xgWeightNonDC = randomIn(0.10, 0.35);
    const meanWeightNonDC = 1 - rollingWeightNonDC - xgWeightNonDC;

    if (meanWeightNonDC < 0.05) continue; // bỏ qua nếu không hợp lệ

    const eloWeight = randomIn(0.10, 0.40);
    const homeAdvFactor = randomIn(0.90, 1.10);
    const drawBoostMax = randomIn(0.0, 0.40);

    const config = {
      decay,
      bivariateWeight,
      nbR,
      mleWeight,
      rollingWeight,
      xgWeight,
      rollingWeightNonDC,
      xgWeightNonDC,
      meanWeightNonDC,
      eloWeight,
      homeAdvFactor,
      drawBoostMax
    };

    let scoreOk = 0;
    let x12Ok = 0;

    for (const item of preparedMatches) {
      // Chèn config này vào params của predict
      const pred = predict({
        ...item,
        homeTeamId: item.m.home_team_id,
        awayTeamId: item.m.away_team_id,
        homeElo: item.m.home_elo || 1500,
        awayElo: item.m.away_elo || 1500,
        matchDate: item.m.date,
        ...config
      });

      const actGF = item.m.score_home;
      const actGA = item.m.score_away;

      if (actGF === pred.score.home && actGA === pred.score.away) {
        scoreOk++;
      }

      const act1X2 = actGF > actGA ? 'home' : (actGF < actGA ? 'away' : 'draw');
      const pred1X2 = pred.result.home > pred.result.draw && pred.result.home > pred.result.away ? 'home' : (pred.result.away > pred.result.home && pred.result.away > pred.result.draw ? 'away' : 'draw');
      if (act1X2 === pred1X2) {
        x12Ok++;
      }
    }

    // Tiêu chí chọn: ưu tiên tỉ số chính xác (Correct Score), sau đó là 1X2
    if (scoreOk > bestScoreAcc || (scoreOk === bestScoreAcc && x12Ok > best1X2Acc)) {
      bestScoreAcc = scoreOk;
      best1X2Acc = x12Ok;
      bestConfig = { ...config };
    }
  }

  console.log('\n🌟 [Tuner] ĐÃ TÌM THẤY BỘ THAM SỐ TỐI ƯU NHẤT!');
  console.log(`🏆 Tỉ lệ trúng tỉ số: ${bestScoreAcc}/${rawMatches.length} (${(bestScoreAcc/rawMatches.length*100).toFixed(1)}%) (Baseline: ${(baselineScoreOk/rawMatches.length*100).toFixed(1)}%)`);
  console.log(`🎯 Tỉ lệ đúng 1X2:    ${best1X2Acc}/${rawMatches.length} (${(best1X2Acc/rawMatches.length*100).toFixed(1)}%) (Baseline: ${(baseline1X2Ok/rawMatches.length*100).toFixed(1)}%)`);

  // Lưu cấu hình vào backend/config/optimal_params.json
  const configDir = path.resolve(process.cwd(), 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, 'optimal_params.json');
  fs.writeFileSync(configPath, JSON.stringify(bestConfig, null, 2), 'utf8');
  console.log(`💾 [Tuner] Đã lưu cấu hình tối ưu tại: ${configPath}`);
  
  process.exit(0);
}

runTuner().catch(err => {
  console.error('❌ [Tuner] Lỗi trong quá trình tối ưu hóa:', err);
  process.exit(1);
});
