/**
 * Main Predictor — combines Poisson, Dixon-Coles, ELO and situational factors
 */

import { calcLambda, buildScoreMatrix, calcResultProbs, calcOverUnder, getMostLikelyScore, getXGStats } from './poisson.js';
import { applyDixonColes } from './dixonColes.js';
import { eloToProbabilityAdjustment } from './elo.js';

const HOME_ADVANTAGE = 1.25;
const LEAGUE_AVG_GOALS = 1.5; // fallback when no real data

/**
 * Calculate weighted attack & defence stats based on 8 recent matches
 * Uses exponential time-decay: w_i = e^(-0.0065 * days_since_match)
 */
function calcWeightedRollingStats(matches, teamId, targetDateStr = null) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;

  matches.forEach((m, idx) => {
    if (idx >= 8) return;
    
    // Tính số ngày t_i
    let diffDays = 4; // mặc định
    if (m.date) {
      const matchDate = new Date(m.date);
      const diffMs = targetDate - matchDate;
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }
    
    // w_i = e^(-0.0065 * t_i)
    const w = Math.exp(-0.0065 * diffDays);
    
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


/**
 * Compute attack/defence strengths from average goals
 * @param {number} homeAvgScored
 * @param {number} homeAvgConceded
 * @param {number} awayAvgScored
 * @param {number} awayAvgConceded
 * @param {number} leagueAvg - league average goals per team per match
 */
function calcStrengths(homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded, leagueAvgHome, leagueAvgAway) {
  const homeAttack = homeAvgScored / leagueAvgHome;
  const homeDefence = homeAvgConceded / leagueAvgHome;
  const awayAttack = awayAvgScored / leagueAvgAway;
  const awayDefence = awayAvgConceded / leagueAvgAway;
  return { homeAttack, homeDefence, awayAttack, awayDefence };
}

/**
 * Apply situational multipliers to lambdas
 * @param {object} lambdas - { homeLambda, awayLambda }
 * @param {object} situationalFactors
 */
function applySituationalFactors(lambdas, situationalFactors = {}) {
  let { homeLambda, awayLambda } = lambdas;
  const factors = [];

  if (situationalFactors.homeFatigue) {
    homeLambda *= 0.85;
    factors.push({ factor: 'Mệt mỏi đội nhà (3 trận/7 ngày)', impact: -0.15, icon: '😴' });
  }
  if (situationalFactors.awayFatigue) {
    awayLambda *= 0.85;
    factors.push({ factor: 'Mệt mỏi đội khách (3 trận/7 ngày)', impact: -0.15, icon: '😴' });
  }
  if (situationalFactors.isDerby) {
    homeLambda *= 1.05;
    awayLambda *= 1.05;
    factors.push({ factor: 'Derby / Trận thù địch', impact: 0.05, icon: '🔥' });
  }
  if (situationalFactors.isImportantMatch) {
    homeLambda *= 1.08;
    factors.push({ factor: 'Trận đấu quan trọng (đua vô địch/trụ hạng)', impact: 0.08, icon: '🏆' });
  }

  return { homeLambda, awayLambda, factors };
}

/**
 * Blend ELO adjustment into result probabilities (30% weight)
 * @param {object} probs - { home, draw, away } from Poisson
 * @param {number} eloHomeWinProb - win probability from ELO (0–1)
 */
function blendEloAdjustment(probs, eloHomeWinProb) {
  const POISSON_WEIGHT = 0.70;
  const ELO_WEIGHT = 0.30;

  // Distribute ELO into home/away, keep draw ratio stable
  const eloHome = eloHomeWinProb;
  const eloAway = 1 - eloHomeWinProb;
  const rawDraw = probs.draw;

  const blendedHome = POISSON_WEIGHT * probs.home + ELO_WEIGHT * eloHome * (1 - rawDraw);
  const blendedAway = POISSON_WEIGHT * probs.away + ELO_WEIGHT * eloAway * (1 - rawDraw);
  const total = blendedHome + rawDraw + blendedAway;

  return {
    home: blendedHome / total,
    draw: rawDraw / total,
    away: blendedAway / total,
  };
}

/**
 * Calculate overall confidence score (0–1)
 * Based on how dominant the most likely outcome is
 */
function calcConfidence(probs, homeStats, awayStats) {
  const maxProb = Math.max(probs.home, probs.draw, probs.away);
  const dataQuality = Math.min(
    1,
    ((homeStats.matches_played || 0) + (awayStats.matches_played || 0)) / 30
  );
  return Math.round((maxProb * 0.7 + dataQuality * 0.3) * 100) / 100;
}

/**
 * Main prediction function
 * @param {object} params
 * @param {object} params.homeStats - { goals_scored, goals_conceded, matches_played, xG, xGA }
 * @param {object} params.awayStats
 * @param {number} params.homeElo
 * @param {number} params.awayElo
 * @param {number} params.leagueAvgGoals
 * @param {object} params.situationalFactors - { homeFatigue, awayFatigue, isDerby, isImportantMatch }
 */
export function predict(params) {
  const {
    homeStats = { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 21, xGA: 14 },
    awayStats = { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 16, xGA: 21 },
    homeRecentMatches = [],
    awayRecentMatches = [],
    homeTeamId,
    awayTeamId,
    homeElo = 1500,
    awayElo = 1500,
    leagueAvgHome = 1.5,
    leagueAvgAway = 1.2,
    situationalFactors = {},
    h2hAvgGoals = 0,
    homeRestDays = 4,
    awayRestDays = 4,
    homeWinRate = 0.5,
    matchDate = null,
  } = params;

  const homeIdNum = homeTeamId !== undefined && homeTeamId !== null ? Number(homeTeamId) : null;
  const awayIdNum = awayTeamId !== undefined && awayTeamId !== null ? Number(awayTeamId) : null;

  // Calculate weighted rolling averages of goals scored/conceded
  let homeAvgScored = 1.2;
  let homeAvgConceded = 1.2;
  let awayAvgScored = 1.2;
  let awayAvgConceded = 1.2;

  const targetDateStr = matchDate || (homeRecentMatches[0]?.date ? homeRecentMatches[0].date : null);

  if (homeRecentMatches && homeRecentMatches.length > 0 && homeIdNum !== null) {
    console.log(`\n=== DEBUG LOGGING: ĐỘI NHÀ (ID: ${homeIdNum}) ===`);
    homeRecentMatches.forEach((m, idx) => {
      if (idx >= 8) return;
      const isHome = Number(m.home_team_id) === homeIdNum;
      const gs = isHome ? m.score_home : m.score_away;
      const ga = isHome ? m.score_away : m.score_home;
      
      let diffDays = 4;
      if (m.date && targetDateStr) {
        diffDays = Math.round((new Date(targetDateStr) - new Date(m.date)) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) diffDays = 4;
      }
      const w = Math.exp(-0.0065 * diffDays);
      console.log(` Trận ${idx+1}: Ngày ${m.date} | ${m.score_home}-${m.score_away} | Vai trò: ${isHome ? 'HOME' : 'AWAY'} | goals_scored thực tế: ${gs} | goals_conceded thực tế: ${ga} | Trọng số Decay: ${w.toFixed(4)} (cách ${diffDays} ngày)`);
    });
    const rolling = calcWeightedRollingStats(homeRecentMatches, homeIdNum, targetDateStr);
    homeAvgScored = rolling.avgScored;
    homeAvgConceded = rolling.avgConceded;
    console.log(` Kết quả tính: avgScored=${homeAvgScored.toFixed(4)}, avgConceded=${homeAvgConceded.toFixed(4)}`);
  } else if (homeStats) {
    const stats = getXGStats(homeStats);
    homeAvgScored = stats.avgScored;
    homeAvgConceded = stats.avgConceded;
  }

  if (awayRecentMatches && awayRecentMatches.length > 0 && awayIdNum !== null) {
    console.log(`=== DEBUG LOGGING: ĐỘI KHÁCH (ID: ${awayIdNum}) ===`);
    awayRecentMatches.forEach((m, idx) => {
      if (idx >= 8) return;
      const isHome = Number(m.home_team_id) === awayIdNum;
      const gs = isHome ? m.score_home : m.score_away;
      const ga = isHome ? m.score_away : m.score_home;
      
      let diffDays = 4;
      if (m.date && targetDateStr) {
        diffDays = Math.round((new Date(targetDateStr) - new Date(m.date)) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) diffDays = 4;
      }
      const w = Math.exp(-0.0065 * diffDays);
      console.log(` Trận ${idx+1}: Ngày ${m.date} | ${m.score_home}-${m.score_away} | Vai trò: ${isHome ? 'HOME' : 'AWAY'} | goals_scored thực tế: ${gs} | goals_conceded thực tế: ${ga} | Trọng số Decay: ${w.toFixed(4)} (cách ${diffDays} ngày)`);
    });
    const rolling = calcWeightedRollingStats(awayRecentMatches, awayIdNum, targetDateStr);
    awayAvgScored = rolling.avgScored;
    awayAvgConceded = rolling.avgConceded;
    console.log(` Kết quả tính: avgScored=${awayAvgScored.toFixed(4)}, avgConceded=${awayAvgConceded.toFixed(4)}`);
  } else if (awayStats) {
    const stats = getXGStats(awayStats);
    awayAvgScored = stats.avgScored;
    awayAvgConceded = stats.avgConceded;
  }

  // Bayesian shrinkage: blend rolling stats (70%) with league mean (30%)
  // Prevents extreme rolling values from producing unrealistic lambdas
  const ROLLING_WEIGHT = 0.60;
  const MEAN_WEIGHT = 0.40;
  homeAvgScored = homeAvgScored * ROLLING_WEIGHT + leagueAvgHome * MEAN_WEIGHT;
  homeAvgConceded = homeAvgConceded * ROLLING_WEIGHT + leagueAvgAway * MEAN_WEIGHT;
  awayAvgScored = awayAvgScored * ROLLING_WEIGHT + leagueAvgAway * MEAN_WEIGHT;
  awayAvgConceded = awayAvgConceded * ROLLING_WEIGHT + leagueAvgHome * MEAN_WEIGHT;

  // Step 1: Calculate attack/defence strengths
  const { homeAttack, homeDefence, awayAttack, awayDefence } = calcStrengths(
    homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded, leagueAvgHome, leagueAvgAway
  );


  // Step 2: Compute base lambdas
  let homeLambda = calcLambda(homeAttack, awayDefence, leagueAvgHome);
  let awayLambda = calcLambda(awayAttack, homeDefence, leagueAvgAway);

  // Step 3: Apply situational multipliers to lambdas
  let { homeLambda: adjHomeLambda, awayLambda: adjAwayLambda, factors } =
    applySituationalFactors({ homeLambda, awayLambda }, situationalFactors);

  console.log(`\n[Predictor] leagueAvgHome = ${leagueAvgHome.toFixed(4)}, leagueAvgAway = ${leagueAvgAway.toFixed(4)}`);
  console.log(`=== DEBUG LOGGING: WEIGHTED LAMBDAS ===`);
  console.log(` Đội nhà Lambda: ${adjHomeLambda.toFixed(4)}`);
  console.log(` Đội khách Lambda: ${adjAwayLambda.toFixed(4)}\n`);

  if (h2hAvgGoals > 2.5) {
    adjHomeLambda *= 1.15;
    adjAwayLambda *= 1.15;
    factors.push({ factor: 'Big Match Factor (H2H bàn thắng TB > 2.5)', impact: 0.15, icon: '⚽' });
  }

  // rest_days factor (if > 5 days, multiply lambda * 1.05)
  if (homeRestDays > 5) {
    adjHomeLambda *= 1.05;
    factors.push({ factor: `Đội nhà nghỉ ngơi tốt (${homeRestDays} ngày)`, impact: 0.05, icon: '🔋' });
  }
  if (awayRestDays > 5) {
    adjAwayLambda *= 1.05;
    factors.push({ factor: `Đội khách nghỉ ngơi tốt (${awayRestDays} ngày)`, impact: 0.05, icon: '🔋' });
  }
  // Lambda ceiling: cap at 3.0 goals — extreme values distort score matrix
  adjHomeLambda = Math.min(adjHomeLambda, 3.0);
  adjAwayLambda = Math.min(adjAwayLambda, 3.0);

  // Step 4: Build Poisson matrix
  let scoreMatrix = buildScoreMatrix(adjHomeLambda, adjAwayLambda);

  // Step 5: Apply Dixon-Coles correction with dynamic rho
  // rho calibrated so totalLambda=2.5 → rho=-0.13 (standard EPL value)
  // Low-scoring (totalLambda < 2.0): rho=-0.18 (stronger low-score correction)
  // High-scoring (totalLambda > 3.5): rho=-0.08 (weaker correction)
  // Linear: rho = -0.255 + 0.05 * totalLambda, clamped to [-0.18, -0.08]
  const totalLambda = adjHomeLambda + adjAwayLambda;
  const rho = Math.max(-0.18, Math.min(-0.08, -0.255 + 0.05 * totalLambda));
  console.log(`[Predictor] Dynamic ρ = ${rho.toFixed(4)} (totalLambda = ${totalLambda.toFixed(4)})`);
  scoreMatrix = applyDixonColes(scoreMatrix, adjHomeLambda, adjAwayLambda, rho);

  // Normalize matrix after Dixon-Coles
  let matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) {
      matrixSum += scoreMatrix[i][j];
    }
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) {
        scoreMatrix[i][j] /= matrixSum;
      }
    }
  }

  // Mild draw boost: max +12% for very even matches, scaled by lambda diff
  // Rationale: Poisson slightly underestimates draws in EPL (~26% actual vs ~23% predicted)
  const diffLambda = Math.abs(adjHomeLambda - adjAwayLambda);
  const maxLambda = Math.max(adjHomeLambda, adjAwayLambda);
  const evenness = Math.max(0, 1 - diffLambda / (maxLambda || 1)); // 0=very uneven, 1=even
  const drawBoost = 1 + (0.18 * evenness); // max 18% boost for even matches
  for (let i = 0; i < scoreMatrix.length; i++) {
    scoreMatrix[i][i] *= drawBoost;
  }
  // Re-normalize after draw boost
  matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) {
      matrixSum += scoreMatrix[i][j];
    }
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) {
        scoreMatrix[i][j] /= matrixSum;
      }
    }
  }


  // Step 6: Extract result probabilities
  const rawProbs = calcResultProbs(scoreMatrix);

  // Step 7: Blend with ELO adjustment
  const eloWinProb = eloToProbabilityAdjustment(homeElo, awayElo);
  const resultProbs = blendEloAdjustment(rawProbs, eloWinProb);

  // Step 8: Over/Under and most likely score
  const overUnder = calcOverUnder(scoreMatrix);
  const predictedScore = getMostLikelyScore(scoreMatrix);

  // Fix 3 — Tài/Xỉu threshold
  const expectedTotalGoals = adjHomeLambda + adjAwayLambda;
  let predictedOU = 'Xỉu';
  if (expectedTotalGoals > 2.7) {
    predictedOU = 'Tài';
  } else if (expectedTotalGoals < 2.3) {
    predictedOU = 'Xỉu';
  } else {
    predictedOU = overUnder.over > 0.5 ? 'Tài' : 'Xỉu';
  }

  // Calculate stats for confidence quality
  const confidenceHomeStats = homeRecentMatches && homeRecentMatches.length > 0
    ? { matches_played: homeRecentMatches.length }
    : homeStats;
  const confidenceAwayStats = awayRecentMatches && awayRecentMatches.length > 0
    ? { matches_played: awayRecentMatches.length }
    : awayStats;
  const confidence = calcConfidence(resultProbs, confidenceHomeStats, confidenceAwayStats);

  // Calculate goals_last5 and clean_sheet_rate if not provided
  let homeGoalsLast5 = params.homeGoalsLast5;
  let homeCleanSheetRate = params.homeCleanSheetRate;
  if (homeRecentMatches && homeRecentMatches.length > 0 && homeIdNum !== null && homeGoalsLast5 === undefined) {
    const last5 = homeRecentMatches.slice(0, 5);
    homeGoalsLast5 = last5.reduce((sum, m) => {
      const gs = Number(m.home_team_id) === homeIdNum ? m.score_home : m.score_away;
      return sum + gs;
    }, 0);
    const cleanSheets = last5.filter(m => {
      const ga = Number(m.home_team_id) === homeIdNum ? m.score_away : m.score_home;
      return ga === 0;
    }).length;
    homeCleanSheetRate = last5.length > 0 ? (cleanSheets / last5.length) : 0;
  }

  let awayGoalsLast5 = params.awayGoalsLast5;
  let awayCleanSheetRate = params.awayCleanSheetRate;
  if (awayRecentMatches && awayRecentMatches.length > 0 && awayIdNum !== null && awayGoalsLast5 === undefined) {
    const last5 = awayRecentMatches.slice(0, 5);
    awayGoalsLast5 = last5.reduce((sum, m) => {
      const gs = Number(m.home_team_id) === awayIdNum ? m.score_home : m.score_away;
      return sum + gs;
    }, 0);
    const cleanSheets = last5.filter(m => {
      const ga = Number(m.home_team_id) === awayIdNum ? m.score_away : m.score_home;
      return ga === 0;
    }).length;
    awayCleanSheetRate = last5.length > 0 ? (cleanSheets / last5.length) : 0;
  }

  return {
    score: predictedScore,
    result: {
      home: Math.round(resultProbs.home * 100) / 100,
      draw: Math.round(resultProbs.draw * 100) / 100,
      away: Math.round(resultProbs.away * 100) / 100,
    },
    overUnder: {
      over25: Math.round(overUnder.over * 100) / 100,
      under25: Math.round(overUnder.under * 100) / 100,
      prediction: predictedOU,
    },
    confidence,
    factors,
    scoreMatrix,
    lambdas: { home: Math.round(adjHomeLambda * 100) / 100, away: Math.round(adjAwayLambda * 100) / 100 },
    goals_last5: {
      home: homeGoalsLast5 || 0,
      away: awayGoalsLast5 || 0,
    },
    clean_sheet_rate: {
      home: homeCleanSheetRate || 0,
      away: awayCleanSheetRate || 0,
    },
    h2h_avg_goals: h2hAvgGoals,
    rest_days: {
      home: homeRestDays,
      away: awayRestDays,
    },
  };
}
