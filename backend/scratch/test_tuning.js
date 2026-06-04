import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { 
  calcLambda, 
  buildBivariateScoreMatrix, 
  buildNegativeBinomialScoreMatrix, 
  blendScoreMatrices, 
  calcResultProbs, 
  calcOverUnder, 
  getMostLikelyScoreConsistent, 
  getXGStats 
} from '../models/poisson.js';
import { applyDixonColes } from '../models/dixonColes.js';
import { eloToProbabilityAdjustment } from '../models/elo.js';

// Custom weighted rolling stats with custom decay
function calcWeightedRollingStats(matches, teamId, targetDateStr, decay) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;

  matches.forEach((m, idx) => {
    if (idx >= 12) return;

    let diffDays = 4;
    if (m.date) {
      const matchDate = new Date(m.date);
      const diffMs = targetDate - matchDate;
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }

    const w = Math.exp(-decay * diffDays);

    const isHome = Number(m.home_team_id) === Number(teamId);
    const gs = isHome ? m.score_home : m.score_away;
    const ga = isHome ? m.score_away : m.score_home;

    weightedGoalsScored += gs * w;
    weightedGoalsConceded += ga * w;
    totalWeight += w;
  });

  const avgScored = totalWeight > 0 ? (weightedGoalsScored / totalWeight) : 1.2;
  const avgConceded = totalWeight > 0 ? (weightedGoalsConceded / totalWeight) : 1.2;

  return { avgScored, avgConceded };
}

function calcVenueSpecificStats(venueMatches, teamId, isHomeRole, targetDateStr, decay) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;

  venueMatches.forEach((m, idx) => {
    if (idx >= 6) return;

    let diffDays = 4;
    if (m.date) {
      const diffMs = targetDate - new Date(m.date);
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }

    const w = Math.exp(-decay * diffDays);

    const gs = isHomeRole ? m.score_home : m.score_away;
    const ga = isHomeRole ? m.score_away : m.score_home;

    weightedGoalsScored += gs * w;
    weightedGoalsConceded += ga * w;
    totalWeight += w;
  });

  if (totalWeight === 0) return null;
  return {
    avgScored: weightedGoalsScored / totalWeight,
    avgConceded: weightedGoalsConceded / totalWeight,
  };
}

function calcStrengths(homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded, leagueAvgHome, leagueAvgAway) {
  const homeAttack = homeAvgScored / leagueAvgHome;
  const homeDefence = homeAvgConceded / leagueAvgHome;
  const awayAttack = awayAvgScored / leagueAvgAway;
  const awayDefence = awayAvgConceded / leagueAvgAway;
  return { homeAttack, homeDefence, awayAttack, awayDefence };
}

function blendEloAdjustment(probs, eloHomeWinProb, eloWeight, eloDiff = 0) {
  let w = eloWeight;
  if (Math.abs(eloDiff) > 200) {
    w = Math.min(0.60, eloWeight + 0.10);
  }
  const poissonWeight = 1 - w;

  const eloHome = eloHomeWinProb;
  const eloAway = 1 - eloHomeWinProb;
  const rawDraw = probs.draw;

  const blendedHome = poissonWeight * probs.home + w * eloHome * (1 - rawDraw);
  const blendedAway = poissonWeight * probs.away + w * eloAway * (1 - rawDraw);
  const total = blendedHome + rawDraw + blendedAway;

  return {
    home: blendedHome / total,
    draw: rawDraw / total,
    away: blendedAway / total,
  };
}

// Prediction engine with tuning parameters
function predictTuned(params, config) {
  const {
    homeStats,
    awayStats,
    homeRecentMatches,
    awayRecentMatches,
    homeHomeRecentMatches,
    awayAwayRecentMatches,
    homeTeamId,
    awayTeamId,
    homeElo,
    awayElo,
    leagueAvgHome,
    leagueAvgAway,
    h2hRecentResults,
    matchDate,
  } = params;

  const {
    decay,
    nbDispersion,
    nbWeight,
    drawBoostMax,
    bivariateCovariance,
    rollingWeight,
    xgWeight,
    meanWeight,
    eloWeight,
    homeAdvFactor
  } = config;

  const homeIdNum = Number(homeTeamId);
  const awayIdNum = Number(awayTeamId);
  const targetDateStr = matchDate;

  let homeRollingAll = { avgScored: 1.2, avgConceded: 1.2 };
  let awayRollingAll = { avgScored: 1.2, avgConceded: 1.2 };

  if (homeRecentMatches && homeRecentMatches.length > 0) {
    homeRollingAll = calcWeightedRollingStats(homeRecentMatches, homeIdNum, targetDateStr, decay);
  } else if (homeStats) {
    const stats = getXGStats(homeStats);
    homeRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  if (awayRecentMatches && awayRecentMatches.length > 0) {
    awayRollingAll = calcWeightedRollingStats(awayRecentMatches, awayIdNum, targetDateStr, decay);
  } else if (awayStats) {
    const stats = getXGStats(awayStats);
    awayRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  let homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded;

  if (homeHomeRecentMatches && homeHomeRecentMatches.length >= 3) {
    const venueHome = calcVenueSpecificStats(homeHomeRecentMatches, homeIdNum, true, targetDateStr, decay);
    if (venueHome) {
      homeAvgScored   = 0.50 * venueHome.avgScored   + 0.30 * homeRollingAll.avgScored   + 0.20 * leagueAvgHome;
      homeAvgConceded = 0.50 * venueHome.avgConceded + 0.30 * homeRollingAll.avgConceded + 0.20 * leagueAvgAway;
    } else {
      homeAvgScored   = homeRollingAll.avgScored;
      homeAvgConceded = homeRollingAll.avgConceded;
    }
  } else {
    homeAvgScored   = homeRollingAll.avgScored;
    homeAvgConceded = homeRollingAll.avgConceded;
  }

  if (awayAwayRecentMatches && awayAwayRecentMatches.length >= 3) {
    const venueAway = calcVenueSpecificStats(awayAwayRecentMatches, awayIdNum, false, targetDateStr, decay);
    if (venueAway) {
      awayAvgScored   = 0.50 * venueAway.avgScored   + 0.30 * awayRollingAll.avgScored   + 0.20 * leagueAvgAway;
      awayAvgConceded = 0.50 * venueAway.avgConceded + 0.30 * awayRollingAll.avgConceded + 0.20 * leagueAvgHome;
    } else {
      awayAvgScored   = awayRollingAll.avgScored;
      awayAvgConceded = awayRollingAll.avgConceded;
    }
  } else {
    awayAvgScored   = awayRollingAll.avgScored;
    awayAvgConceded = awayRollingAll.avgConceded;
  }

  const homeXG = getXGStats(homeStats);
  const awayXG = getXGStats(awayStats);

  homeAvgScored   = homeAvgScored   * rollingWeight + homeXG.avgScored   * xgWeight + leagueAvgHome * meanWeight;
  homeAvgConceded = homeAvgConceded * rollingWeight + homeXG.avgConceded * xgWeight + leagueAvgAway * meanWeight;
  awayAvgScored   = awayAvgScored   * rollingWeight + awayXG.avgScored   * xgWeight + leagueAvgAway * meanWeight;
  awayAvgConceded = awayAvgConceded * rollingWeight + awayXG.avgConceded * xgWeight + leagueAvgHome * meanWeight;

  const homeAdvantage = leagueAvgAway > 0 ? (leagueAvgHome / leagueAvgAway) : 1.25;
  const homeAdvantageClamped = Math.max(0.9, Math.min(1.5, homeAdvantage * homeAdvFactor));

  const homeAvgScoredAdj   = homeAvgScored   * homeAdvantageClamped;
  const homeAvgConcededAdj = homeAvgConceded / homeAdvantageClamped;

  const { homeAttack, homeDefence, awayAttack, awayDefence } = calcStrengths(
    homeAvgScoredAdj, homeAvgConcededAdj,
    awayAvgScored, awayAvgConceded,
    leagueAvgHome, leagueAvgAway
  );

  let homeLambda = calcLambda(homeAttack, awayDefence, leagueAvgHome);
  let awayLambda = calcLambda(awayAttack, homeDefence, leagueAvgAway);

  // Form momentum
  function calcFormMomentum(recentMatches, teamId) {
    if (!recentMatches || recentMatches.length < 3) return 1.0;
    const last3 = recentMatches.slice(0, 3);
    let wins = 0, losses = 0;
    for (const m of last3) {
      const isHome = Number(m.home_team_id) === Number(teamId);
      const gs = isHome ? m.score_home : m.score_away;
      const ga = isHome ? m.score_away : m.score_home;
      if (gs > ga) wins++;
      else if (gs < ga) losses++;
    }
    if (wins === 3) return 1.05;
    if (losses === 3) return 0.95;
    return 1.0;
  }

  homeLambda *= calcFormMomentum(homeRecentMatches, homeIdNum);
  awayLambda *= calcFormMomentum(awayRecentMatches, awayIdNum);

  // Lambda ceiling: cap at 3.0 goals
  homeLambda = Math.min(homeLambda, 3.0);
  awayLambda = Math.min(awayLambda, 3.0);

  const bivariateMatrix = buildBivariateScoreMatrix(homeLambda, awayLambda, bivariateCovariance);
  const nbMatrix = buildNegativeBinomialScoreMatrix(homeLambda, awayLambda, nbDispersion);
  let scoreMatrix = blendScoreMatrices(bivariateMatrix, nbMatrix, 1 - nbWeight);

  const totalLambda = homeLambda + awayLambda;
  const rho = Math.max(-0.18, Math.min(-0.08, -0.255 + 0.05 * totalLambda));
  scoreMatrix = applyDixonColes(scoreMatrix, homeLambda, awayLambda, rho);

  // Normalize
  let matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) matrixSum += scoreMatrix[i][j];
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) scoreMatrix[i][j] /= matrixSum;
    }
  }

  // Draw boost
  const diffLambda = Math.abs(homeLambda - awayLambda);
  const maxLambda = Math.max(homeLambda, awayLambda);
  const evenness = Math.max(0, 1 - diffLambda / (maxLambda || 1));
  const drawBoost = 1 + (drawBoostMax * evenness);
  for (let i = 0; i < scoreMatrix.length; i++) scoreMatrix[i][i] *= drawBoost;

  // Re-normalize
  matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) matrixSum += scoreMatrix[i][j];
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) scoreMatrix[i][j] /= matrixSum;
    }
  }

  let rawProbs = calcResultProbs(scoreMatrix);

  // H2H adjustment
  if (h2hRecentResults && h2hRecentResults.length >= 3) {
    const h2hTotal = h2hRecentResults.length;
    let h2hHomeWins = 0, h2hDraws = 0, h2hAwayWins = 0;
    for (const r of h2hRecentResults) {
      if (r.homeGoals > r.awayGoals) h2hHomeWins++;
      else if (r.homeGoals === r.awayGoals) h2hDraws++;
      else h2hAwayWins++;
    }
    const h2hHomePct = h2hHomeWins / h2hTotal;
    const h2hDrawPct = h2hDraws / h2hTotal;
    const h2hAwayPct = h2hAwayWins / h2hTotal;

    const H2H_WEIGHT = 0.20;
    if (h2hHomePct >= 0.6 || h2hAwayPct >= 0.6) {
      const blendedHome = (1 - H2H_WEIGHT) * rawProbs.home + H2H_WEIGHT * h2hHomePct;
      const blendedDraw = (1 - H2H_WEIGHT) * rawProbs.draw + H2H_WEIGHT * h2hDrawPct;
      const blendedAway = (1 - H2H_WEIGHT) * rawProbs.away + H2H_WEIGHT * h2hAwayPct;
      const bTotal = blendedHome + blendedDraw + blendedAway;
      rawProbs = { home: blendedHome / bTotal, draw: blendedDraw / bTotal, away: blendedAway / bTotal };
    }
  }

  // ELO blend
  const eloWinProb = eloToProbabilityAdjustment(homeElo, awayElo);
  const resultProbs = blendEloAdjustment(rawProbs, eloWinProb, eloWeight, homeElo - awayElo);

  // Partition scaling
  let currentSumHome = 0, currentSumDraw = 0, currentSumAway = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) {
      if (i > j) currentSumHome += scoreMatrix[i][j];
      else if (i === j) currentSumDraw += scoreMatrix[i][j];
      else currentSumAway += scoreMatrix[i][j];
    }
  }

  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) {
      if (i > j && currentSumHome > 0) {
        scoreMatrix[i][j] *= (resultProbs.home / currentSumHome);
      } else if (i === j && currentSumDraw > 0) {
        scoreMatrix[i][j] *= (resultProbs.draw / currentSumDraw);
      } else if (i < j && currentSumAway > 0) {
        scoreMatrix[i][j] *= (resultProbs.away / currentSumAway);
      }
    }
  }

  const predictedScore = getMostLikelyScoreConsistent(scoreMatrix, resultProbs);

  return {
    score: predictedScore,
    resultProbs,
    overUnder: calcOverUnder(scoreMatrix),
  };
}

async function runGridSearch() {
  console.log('Loading matches and statistics from database...');
  const db = await getDatabase();
  const rawMatches = await queryAll(db,
    `SELECT m.*, ht.name as home_name, at.name as away_name,
            ht.elo_rating as home_elo, at.elo_rating as away_elo
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       AND m.date BETWEEN '2024-11-01' AND '2025-02-28'
     ORDER BY m.date DESC LIMIT 50`
  );

  const preparedMatches = [];

  for (const m of rawMatches) {
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
    });
  }

  // Pre-load odds from odds_cache table
  for (const item of preparedMatches) {
    const oddsRow = await queryGet(db, 
      `SELECT home_prob, draw_prob, away_prob, over25_prob, under25_prob 
       FROM odds_cache 
       WHERE match_id = ?`, 
      [item.m.id]
    );
    item.odds = oddsRow;
  }

  console.log('Pre-fetching complete. Starting grid search...');

  // Define parameter ranges around our best config:
  // Best: decay=0.005, nbDispersion=10, nbWeight=0.1, drawBoost=0.3, cov=0.12, weights={r:0.55,x:0.2,m:0.25}, eloWeight=0.2, homeAdvFactor=0.95
  const decays = [0.0045, 0.005, 0.0055];
  const nbDispersions = [8.0, 10.0, 11.0];
  const nbWeights = [0.05, 0.10, 0.15];
  const drawBoosts = [0.28, 0.30, 0.32];
  const covs = [0.11, 0.12, 0.13];
  const weights = [
    { r: 0.55, x: 0.20, m: 0.25 },
    { r: 0.52, x: 0.22, m: 0.26 }
  ];
  const eloWeights = [0.15, 0.20, 0.25];
  const homeAdvFactors = [0.93, 0.95, 0.97];

  let bestScoreAcc = -1;
  let best1X2Acc = -1;
  let bestOUAcc = -1;
  let bestConfig = null;

  const totalConfigs = decays.length * nbDispersions.length * nbWeights.length * drawBoosts.length * covs.length * weights.length * eloWeights.length * homeAdvFactors.length;
  console.log(`Testing ${totalConfigs} configurations...`);

  let count = 0;

  for (const decay of decays) {
    for (const nbDispersion of nbDispersions) {
      for (const nbWeight of nbWeights) {
        for (const drawBoostMax of drawBoosts) {
          for (const bivariateCovariance of covs) {
            for (const w of weights) {
              for (const eloWeight of eloWeights) {
                for (const homeAdvFactor of homeAdvFactors) {
                  count++;
                  if (count % 2000 === 0) {
                    console.log(`Progress: ${count}/${totalConfigs} configurations evaluated...`);
                  }

                  const config = {
                    decay,
                    nbDispersion,
                    nbWeight,
                    drawBoostMax,
                    bivariateCovariance,
                    rollingWeight: w.r,
                    xgWeight: w.x,
                    meanWeight: w.m,
                    eloWeight,
                    homeAdvFactor
                  };

                  let scoreOk = 0;
                  let x12Ok = 0;
                  let ouOk = 0;

                  for (const item of preparedMatches) {
                    const pred = predictTuned({
                      homeStats: item.homeStats,
                      awayStats: item.awayStats,
                      homeRecentMatches: item.homeRecentMatches,
                      awayRecentMatches: item.awayRecentMatches,
                      homeHomeRecentMatches: item.homeHomeRecentMatches,
                      awayAwayRecentMatches: item.awayAwayRecentMatches,
                      homeTeamId: item.m.home_team_id,
                      awayTeamId: item.m.away_team_id,
                      homeElo: item.m.home_elo || 1500,
                      awayElo: item.m.away_elo || 1500,
                      leagueAvgHome: item.leagueAvgHome,
                      leagueAvgAway: item.leagueAvgAway,
                      h2hRecentResults: item.h2hRecentResults,
                      matchDate: item.m.date,
                    }, config);

                    // Blend with bookmaker odds if available
                    let finalResult = { ...pred.resultProbs };
                    let finalOU = { ...pred.overUnder };

                    if (item.odds) {
                      const o = item.odds;
                      const maxProb = Math.max(pred.resultProbs.home, pred.resultProbs.draw, pred.resultProbs.away);
                      const conf = Math.round((maxProb * 0.7 + 0.8 * 0.3) * 100) / 100;
                      
                      let modelWeight = 0.55;
                      if (conf >= 0.65) modelWeight = 0.70;
                      else if (conf < 0.45) modelWeight = 0.35;
                      const bookWeight = 1 - modelWeight;

                      const blendedHome = modelWeight * pred.resultProbs.home + bookWeight * o.home_prob;
                      const blendedDraw = modelWeight * pred.resultProbs.draw + bookWeight * o.draw_prob;
                      const blendedAway = modelWeight * pred.resultProbs.away + bookWeight * o.away_prob;
                      const totalB = blendedHome + blendedDraw + blendedAway;

                      finalResult = {
                        home: blendedHome / totalB,
                        draw: blendedDraw / totalB,
                        away: blendedAway / totalB,
                      };
                    }

                    const actGF = item.m.score_home;
                    const actGA = item.m.score_away;
                    const act1X2 = actGF > actGA ? '1' : (actGF < actGA ? '2' : 'X');
                    const actOU = (actGF + actGA) > 2.5 ? 'Tài' : 'Xỉu';

                    // Check 1X2
                    let pred1X2 = 'X';
                    const maxP = Math.max(finalResult.home, finalResult.draw, finalResult.away);
                    if (maxP === finalResult.home) pred1X2 = '1';
                    else if (maxP === finalResult.away) pred1X2 = '2';

                    if (act1X2 === pred1X2) x12Ok++;

                    // Check Over/Under prediction
                    let predictedOU = finalOU.over > 0.5 ? 'Tài' : 'Xỉu';
                    if (actOU === predictedOU) ouOk++;

                    // Check exact score
                    if (actGF === pred.score.home && actGA === pred.score.away) scoreOk++;
                  }

                  if (scoreOk > bestScoreAcc || (scoreOk === bestScoreAcc && x12Ok > best1X2Acc)) {
                    bestScoreAcc = scoreOk;
                    best1X2Acc = x12Ok;
                    bestOUAcc = ouOk;
                    bestConfig = { ...config };
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log('\n--- TUNING GRID SEARCH COMPLETE ---');
  console.log(`Best Exact Score Accuracy: ${bestScoreAcc}/50 (${(bestScoreAcc/50*100).toFixed(1)}%)`);
  console.log(`Corresponding 1X2 Accuracy: ${best1X2Acc}/50 (${(best1X2Acc/50*100).toFixed(1)}%)`);
  console.log(`Corresponding Over/Under Accuracy: ${bestOUAcc}/50 (${(bestOUAcc/50*100).toFixed(1)}%)`);
  console.log('Best Configuration:', bestConfig);
}

runGridSearch();
