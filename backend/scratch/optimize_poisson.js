import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';
import { getDixonColesStrengths } from '../utils/dixonColesSolver.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';

async function optimize() {
  const originalLog = console.log;
  
  const db = await getDatabase();
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

  originalLog(`Loaded ${matches.length} matches for optimization.`);

  const matchDataList = [];
  for (const m of matches) {
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
    let h2hAvgGoals = 0;
    if (h2hMatches.length > 0) {
      const totalGoals = h2hMatches.reduce((sum, hm) => sum + hm.score_home + hm.score_away, 0);
      h2hAvgGoals = totalGoals / h2hMatches.length;
    }
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

    function calcRestDays(target, last) {
      if (!last || !target) return 4;
      const diff = Math.round((new Date(target) - new Date(last)) / (1000 * 60 * 60 * 24));
      return diff >= 0 ? diff : 4;
    }
    const homeRestDays = calcRestDays(matchDate, homeRecentMatches[0]?.date);
    const awayRestDays = calcRestDays(matchDate, awayRecentMatches[0]?.date);

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

    const dixonColesStrengths = await getDixonColesStrengths(m.league, m.season, matchDate);

    matchDataList.push({
      m,
      homeStats,
      awayStats,
      homeRecentMatches,
      awayRecentMatches,
      homeHomeRecentMatches,
      awayAwayRecentMatches,
      leagueAvgHome,
      leagueAvgAway,
      h2hAvgGoals,
      h2hRecentResults,
      homeRestDays,
      awayRestDays,
      homeWinRate,
      dixonColesStrengths,
    });
  }

  originalLog('Finished pre-fetching data. Starting optimization...');

  // Tạo tổ hợp grid search
  const bivariateWeights = [0.80, 0.90, 0.95, 1.00];
  const drawBoostMaxs = [0.0, 0.10, 0.20, 0.28, 0.35, 0.45];
  const rhoVals = [undefined, -0.05, -0.10, -0.15];

  const results = [];

  // Mute logs
  console.log = () => {};

  for (const bw of bivariateWeights) {
    for (const dbm of drawBoostMaxs) {
      for (const rv of rhoVals) {
        let correctScore = 0;
        let correct1X2 = 0;
        let correctOU = 0;

        for (const data of matchDataList) {
          const pred = predict({
            homeStats: data.homeStats,
            awayStats: data.awayStats,
            homeRecentMatches: data.homeRecentMatches,
            awayRecentMatches: data.awayRecentMatches,
            homeHomeRecentMatches: data.homeHomeRecentMatches,
            awayAwayRecentMatches: data.awayAwayRecentMatches,
            homeTeamId: data.m.home_team_id,
            awayTeamId: data.m.away_team_id,
            homeElo: data.m.home_elo || 1500,
            awayElo: data.m.away_elo || 1500,
            leagueAvgHome: data.leagueAvgHome,
            leagueAvgAway: data.leagueAvgAway,
            situationalFactors: {},
            h2hAvgGoals: data.h2hAvgGoals,
            h2hRecentResults: data.h2hRecentResults,
            homeRestDays: data.homeRestDays,
            awayRestDays: data.awayRestDays,
            homeWinRate: data.homeWinRate,
            matchDate: data.m.date,
            isNeutral: false,
            
            // Fixed best Dixon-Coles blend
            dixonColesStrengths: data.dixonColesStrengths,
            mleWeight: 0.20,
            rollingWeight: 0.60,
            xgWeight: 0.20,

            // Hyper-parameters to sweep
            bivariateWeight: bw,
            drawBoostMax: dbm,
            rhoVal: rv,
          });

          const blend = await blendWithBookmaker(pred.result, pred.overUnder, data.m.id, db, pred.confidence, true);
          pred.result = blend.result;
          pred.overUnder = blend.overUnder;

          const calibratedMatrix = calibrateMatrixIPF(pred.scoreMatrix, pred.result, pred.overUnder);
          pred.scoreMatrix = calibratedMatrix;
          pred.score = getMostLikelyScoreConsistent(calibratedMatrix, pred.result);

          const actGF = data.m.score_home;
          const actGA = data.m.score_away;
          const actTotal = actGF + actGA;
          const act1X2 = actGF > actGA ? '1' : (actGF < actGA ? '2' : 'X');
          const actOU = actTotal > 2.5 ? 'Tài' : 'Xỉu';

          const predGF = pred.score.home;
          const predGA = pred.score.away;
          let pred1X2 = 'X';
          const maxProb = Math.max(pred.result.home, pred.result.draw, pred.result.away);
          if (maxProb === pred.result.home) pred1X2 = '1';
          else if (maxProb === pred.result.away) pred1X2 = '2';

          const predOU = pred.overUnder.prediction;

          if (actGF === predGF && actGA === predGA) correctScore++;
          if (act1X2 === pred1X2) correct1X2++;
          if (actOU === predOU) correctOU++;
        }

        results.push({
          bivariateWeight: bw,
          drawBoostMax: dbm,
          rhoVal: rv === undefined ? 'dynamic' : rv,
          correctScore,
          scoreAcc: `${(correctScore/50*100).toFixed(1)}%`,
          correct1X2,
          resultAcc: `${(correct1X2/50*100).toFixed(1)}%`,
          correctOU,
          ouAcc: `${(correctOU/50*100).toFixed(1)}%`,
        });
      }
    }
  }

  console.log = originalLog;
  
  // Sắp xếp kết quả theo correctScore giảm dần để xem cấu hình tốt nhất lên hàng đầu
  results.sort((a, b) => b.correctScore - a.correctScore);
  
  console.log('Top 15 configurations:');
  console.table(results.slice(0, 15));
}

optimize();
