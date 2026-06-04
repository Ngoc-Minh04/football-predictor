import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';
import { getDixonColesStrengths } from '../utils/dixonColesSolver.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';
import fs from 'fs';
import path from 'path';

async function autoTune() {
  const originalLog = console.log;
  const db = await getDatabase();
  
  // Load 60 recent finished matches to tune
  const matches = await queryAll(db,
    `SELECT m.*, ht.name as home_name, at.name as away_name,
            ht.elo_rating as home_elo, at.elo_rating as away_elo
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
     ORDER BY m.date DESC LIMIT 60`
  );

  originalLog(`[Auto-Tune] Loaded ${matches.length} matches for tuning.`);

  const matchDataList = [];
  for (const m of matches) {
    const matchDate = m.date;
    const homeId = m.home_team_id;
    const awayId = m.away_team_id;

    const leagueAvgHomeRow = await queryGet(db,
      `SELECT AVG(CAST(score_home AS REAL)) as avg FROM matches
       WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
      [m.league, matchDate, m.season]
    );
    const leagueAvgAwayRow = await queryGet(db,
      `SELECT AVG(CAST(score_away AS REAL)) as avg FROM matches
       WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
      [m.league, matchDate, m.season]
    );
    const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
    const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

    const h2hMatches = await queryAll(db,
      `SELECT score_home, score_away FROM matches
       WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL AND date < ?
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
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
       WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'FINISHED' AND date < ?
       ORDER BY date DESC LIMIT 12`,
      [homeId, homeId, matchDate]
    );
    const awayRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
       WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'FINISHED' AND date < ?
       ORDER BY date DESC LIMIT 12`,
      [awayId, awayId, matchDate]
    );

    const homeHomeRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
       WHERE m.home_team_id = ? AND m.status = 'FINISHED' AND date < ?
       ORDER BY date DESC LIMIT 6`,
      [homeId, matchDate]
    );
    const awayAwayRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
       WHERE m.away_team_id = ? AND m.status = 'FINISHED' AND date < ?
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
       WHERE home_team_id = ? AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL AND date < ?
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

    let dixonColesStrengths = null;
    try {
      dixonColesStrengths = await getDixonColesStrengths(m.league, m.season, matchDate);
    } catch (_) {}

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

  originalLog('[Auto-Tune] Pre-fetch complete. Stage 1: Tuning eloLambdaDivisor, nbR and lambda3...');
  console.log = () => {};

  const nbRVals = [1.5, 2.0, 4.0, 8.0, 12.0];
  const eloDivisorVals = [0, 1800, 2400, 3000, 4000]; // 0 = disabled
  const lambda3Vals = [0.02, 0.05, 0.10, 0.15];

  let bestScoreStage1 = -1;
  let bestNbR = 2.0;
  let bestEloDivisor = 3000;
  let bestLambda3 = 0.02;

  for (const r of nbRVals) {
    for (const div of eloDivisorVals) {
      for (const l3 of lambda3Vals) {
        let correctScore = 0;
        for (const data of matchDataList) {
          const pred = predict({
            ...data,
            homeTeamId: data.m.home_team_id,
            awayTeamId: data.m.away_team_id,
            homeElo: data.m.home_elo || 1500,
            awayElo: data.m.away_elo || 1500,
            matchDate: data.m.date,
            isNeutral: data.m.league === 'WC' || data.m.league === 'EC',
            nbR: r,
            eloLambdaDivisor: div,
            lambda3: l3,
          });

          const blend = await blendWithBookmaker(pred.result, pred.overUnder, data.m.id, db, pred.confidence, true);
          pred.result = blend.result;
          pred.overUnder = blend.overUnder;

          const calibrated = calibrateMatrixIPF(pred.scoreMatrix, pred.result, pred.overUnder);
          const score = getMostLikelyScoreConsistent(calibrated, pred.result);

          if (data.m.score_home === score.home && data.m.score_away === score.away) {
            correctScore++;
          }
        }

        if (correctScore > bestScoreStage1) {
          bestScoreStage1 = correctScore;
          bestNbR = r;
          bestEloDivisor = div;
          bestLambda3 = l3;
        }
      }
    }
  }

  console.log = originalLog;
  originalLog(`[Auto-Tune] Stage 1 finished. Best lambda3: ${bestLambda3}, nbR: ${bestNbR}, eloLambdaDivisor: ${bestEloDivisor} (Correct Score: ${bestScoreStage1}/${matches.length})`);

  originalLog('[Auto-Tune] Stage 2: Tuning weights (bivariateWeight, eloWeight, decay)...');
  console.log = () => {};

  const bivariateWeights = [0.50, 0.70, 0.90];
  const eloWeights = [0.10, 0.20, 0.35];
  const decayVals = [0.003, 0.0045, 0.006];
  const drawBoostMaxs = [0.0, 0.15, 0.30];

  let bestScoreStage2 = -1;
  let bestBw = 0.70;
  let bestEloW = 0.15;
  let bestDecay = 0.0045;
  let bestDbm = 0.0;

  for (const bw of bivariateWeights) {
    for (const eloW of eloWeights) {
      for (const dec of decayVals) {
        for (const dbm of drawBoostMaxs) {
          let correctScore = 0;
          for (const data of matchDataList) {
            const pred = predict({
              ...data,
              homeTeamId: data.m.home_team_id,
              awayTeamId: data.m.away_team_id,
              homeElo: data.m.home_elo || 1500,
              awayElo: data.m.away_elo || 1500,
              matchDate: data.m.date,
              isNeutral: data.m.league === 'WC' || data.m.league === 'EC',
              
              // Best from Stage 1
              nbR: bestNbR,
              eloLambdaDivisor: bestEloDivisor,
              lambda3: bestLambda3,

              // Sweeping Stage 2
              bivariateWeight: bw,
              eloWeight: eloW,
              decay: dec,
              drawBoostMax: dbm,
            });

            const blend = await blendWithBookmaker(pred.result, pred.overUnder, data.m.id, db, pred.confidence, true);
            pred.result = blend.result;
            pred.overUnder = blend.overUnder;

            const calibrated = calibrateMatrixIPF(pred.scoreMatrix, pred.result, pred.overUnder);
            const score = getMostLikelyScoreConsistent(calibrated, pred.result);

            if (data.m.score_home === score.home && data.m.score_away === score.away) {
              correctScore++;
            }
          }

          if (correctScore > bestScoreStage2) {
            bestScoreStage2 = correctScore;
            bestBw = bw;
            bestEloW = eloW;
            bestDecay = dec;
            bestDbm = dbm;
          }
        }
      }
    }
  }

  console.log = originalLog;
  originalLog(`[Auto-Tune] Stage 2 finished. Best bivariateWeight: ${bestBw}, eloWeight: ${bestEloW}, decay: ${bestDecay}, drawBoostMax: ${bestDbm} (Correct Score: ${bestScoreStage2}/${matches.length})`);

  // Save optimal parameters to optimal_params.json
  const paramsPath = path.resolve(process.cwd(), 'config/optimal_params.json');
  const dir = path.dirname(paramsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing, update, and write
  let config = {};
  if (fs.existsSync(paramsPath)) {
    try {
      config = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    } catch (_) {}
  }

  config = {
    ...config,
    lambda3: bestLambda3,
    nbR: bestNbR,
    eloLambdaDivisor: bestEloDivisor,
    bivariateWeight: bestBw,
    eloWeight: bestEloW,
    decay: bestDecay,
    drawBoostMax: bestDbm
  };

  fs.writeFileSync(paramsPath, JSON.stringify(config, null, 2), 'utf8');
  originalLog(`[Auto-Tune] Successfully saved optimized parameters to: ${paramsPath}`);
}

autoTune().catch(err => console.error('[Auto-Tune] Failed:', err));
