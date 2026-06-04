import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';
import { getDixonColesStrengths } from './dixonColesSolver.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';

async function runBacktest() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║           Football Predictor — Backtest Engine       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  try {
    const db = await getDatabase();

    // 1. Lấy 50 trận đấu từ tháng 11/2024 đến tháng 2/2025 (vòng 10 đến 30)
    const matches = await queryAll(db,
      `SELECT m.*, ht.name as home_name, at.name as away_name,
              ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
         AND m.date BETWEEN '2024-11-01' AND '2025-02-28'
       ORDER BY m.date DESC LIMIT 50`
    );

    if (matches.length === 0) {
      console.log('❌ Không tìm thấy trận đấu nào thỏa mãn điều kiện thời gian (tháng 11/2024 đến 2/2025) để backtest.');
      process.exit(0);
    }

    console.log(`📊 Đang chạy backtest cho ${matches.length} trận đấu (tháng 11/2024 đến 2/2025)...\n`);


    let correct1X2 = 0;
    let correctOU = 0;
    let correctScore = 0;
    const tableData = [];

    for (const m of matches) {
      const matchDate = m.date;
      const homeId = m.home_team_id;
      const awayId = m.away_team_id;

      // Lấy league average goals trước ngày của trận đấu (lọc theo mùa hiện tại và các trận đã đấu trước đó)
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

      // H2H trước ngày trận đấu
      const h2hMatches = await queryAll(db,
        `SELECT score_home, score_away FROM matches
         WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
           AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
           AND date < ?
         ORDER BY date DESC LIMIT 5`,
        [homeId, awayId, awayId, homeId, matchDate]
      );

      let h2hAvgGoals = 0;
      if (h2hMatches.length > 0) {
        const totalGoals = h2hMatches.reduce((sum, hm) => sum + hm.score_home + hm.score_away, 0);
        h2hAvgGoals = totalGoals / h2hMatches.length;
      }

      // 12 trận gần nhất (mixed home+away) trước ngày trận đấu
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

      // Upgrade 1: 6 trận sân nhà của Home team (chỉ khi đá tại sân nhà)
      const homeHomeRecentMatches = await queryAll(db,
        `SELECT * FROM matches
         WHERE home_team_id = ?
           AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
           AND date < ?
         ORDER BY date DESC LIMIT 6`,
        [homeId, matchDate]
      );

      // Upgrade 1: 6 trận sân khách của Away team (chỉ khi đá sân khách)
      const awayAwayRecentMatches = await queryAll(db,
        `SELECT * FROM matches
         WHERE away_team_id = ?
           AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
           AND date < ?
         ORDER BY date DESC LIMIT 6`,
        [awayId, matchDate]
      );

      // Upgrade 3: H2H kết quả gần nhất (score để tính win/draw/loss rate)
      const h2hRecentResults = h2hMatches.map(hm => ({ homeGoals: hm.score_home, awayGoals: hm.score_away }));

      // Tính rest days trước trận đấu
      function calcRestDays(target, last) {
        if (!last || !target) return 4;
        const diff = Math.round((new Date(target) - new Date(last)) / (1000 * 60 * 60 * 24));
        return diff >= 0 ? diff : 4;
      }
      const homeRestDays = calcRestDays(matchDate, homeRecentMatches[0]?.date);
      const awayRestDays = calcRestDays(matchDate, awayRecentMatches[0]?.date);

      // Fetch last 10 finished home matches for home team before this match
      const homeHomeMatches = await queryAll(db,
        `SELECT score_home, score_away FROM matches
         WHERE home_team_id = ? AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
           AND date < ?
         ORDER BY date DESC LIMIT 10`,
        [homeId, matchDate]
      );
      let homeWinRate = 0.5;
      if (homeHomeMatches.length > 0) {
        const wins = homeHomeMatches.filter(hm => hm.score_home > hm.score_away).length;
        homeWinRate = wins / homeHomeMatches.length;
      }

      const homeStats = await queryGet(db,
        'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
        [homeId, m.season]
      ) || { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 0, xGA: 0 };

      const awayStats = await queryGet(db,
        'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
        [awayId, m.season]
      ) || { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 0, xGA: 0 };

      // Calculate Dixon-Coles strengths dynamically
      let dixonColesStrengths = null;
      try {
        dixonColesStrengths = await getDixonColesStrengths(m.league, m.season, matchDate);
      } catch (dcErr) {
        console.warn(`[backtest] Failed to calculate Dixon-Coles strengths for ${matchDate}: ${dcErr.message}`);
      }

      // Chạy predict engine
      const pred = predict({
        homeStats,
        awayStats,
        homeRecentMatches,
        awayRecentMatches,
        homeHomeRecentMatches,   // Upgrade 1
        awayAwayRecentMatches,   // Upgrade 1
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeElo: m.home_elo || 1500,
        awayElo: m.away_elo || 1500,
        leagueAvgHome,
        leagueAvgAway,
        situationalFactors: {},
        h2hAvgGoals,
        h2hRecentResults,        // Upgrade 3
        homeRestDays,
        awayRestDays,
        homeWinRate,
        matchDate,
        isNeutral: false,        // Upgrade 2: EPL không phải sân trung lập
        dixonColesStrengths,
      });

      // Blend with Bookmaker Odds if available
      const blend = await blendWithBookmaker(pred.result, pred.overUnder, m.id, db, pred.confidence, true);
      pred.result = blend.result;
      pred.overUnder = blend.overUnder;

      // Calibrate score matrix using Iterative Proportional Fitting (IPF)
      const calibratedMatrix = calibrateMatrixIPF(pred.scoreMatrix, pred.result, pred.overUnder);
      pred.scoreMatrix = calibratedMatrix;
      pred.score = getMostLikelyScoreConsistent(calibratedMatrix, pred.result);


      // Kết quả thực
      const actGF = m.score_home;
      const actGA = m.score_away;
      const actTotal = actGF + actGA;
      const act1X2 = actGF > actGA ? '1' : (actGF < actGA ? '2' : 'X');
      const actOU = actTotal > 2.5 ? 'Tài' : 'Xỉu';

      // Dự đoán của model
      const predGF = pred.score.home;
      const predGA = pred.score.away;
      
      // Tìm xác suất cao nhất của 1, X, 2
      let pred1X2 = 'X';
      const maxProb = Math.max(pred.result.home, pred.result.draw, pred.result.away);
      if (maxProb === pred.result.home) pred1X2 = '1';
      else if (maxProb === pred.result.away) pred1X2 = '2';

      const predOU = pred.overUnder.prediction;

      // Đánh giá đúng/sai
      const ok1X2 = act1X2 === pred1X2;
      const okOU = actOU === predOU;
      const okScore = actGF === predGF && actGA === predGA;

      if (ok1X2) correct1X2++;
      if (okOU) correctOU++;
      if (okScore) correctScore++;

      tableData.push({
        'Ngày': matchDate,
        'Trận đấu': `${m.home_name} vs ${m.away_name}`,
        'KQ Thực': `${actGF}-${actGA} (${act1X2})`,
        'Dự Đoán': `${predGF}-${predGA} (${pred1X2})`,
        'Đúng Tỉ Số': okScore ? '✅' : '❌',
        'Đúng 1X2': ok1X2 ? '✅' : '❌',
        'Tài/Xỉu Thực': actOU,
        'Tài/Xỉu Đoán': predOU,
        'Đúng T/X': okOU ? '✅' : '❌',
      });
    }

    console.table(tableData);

    const total = matches.length;
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🏁  TỔNG KẾT HỆ SỐ CHÍNH XÁC (ACCURACY)');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`⚽ Đúng tỉ số chính xác:   ${correctScore}/${total} (${((correctScore / total) * 100).toFixed(1)}%)`);
    console.log(`⚖️  Đúng thắng/hòa/thua (1X2): ${correct1X2}/${total} (${((correct1X2 / total) * 100).toFixed(1)}%)`);
    console.log(`🥅 Đúng Tài/Xỉu 2.5:       ${correctOU}/${total} (${((correctOU / total) * 100).toFixed(1)}%)`);
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Lỗi chạy backtest:', err.message);
  }
  process.exit(0);
}

runBacktest();
