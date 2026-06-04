/**
 * Main Predictor — combines Poisson, Dixon-Coles, ELO and situational factors
 *
 * Upgrade 1: Venue-specific rolling stats (home team uses home-only matches, away uses away-only)
 * Upgrade 2: Dynamic home advantage (calculated from DB data, not hardcoded 1.25)
 *            + isNeutral flag for World Cup / neutral venue matches
 */

import { calcLambda, buildBivariateScoreMatrix, calcResultProbs, calcOverUnder, getMostLikelyScoreConsistent, getXGStats } from './poisson.js';
import { applyDixonColes } from './dixonColes.js';
import { eloToProbabilityAdjustment } from './elo.js';

const LEAGUE_AVG_GOALS = 1.5; // fallback when no real data

/**
 * Calculate weighted rolling stats (all recent matches, mixed home+away)
 * Uses exponential time-decay: w_i = e^(-0.0065 * days_since_match)
 */
function calcWeightedRollingStats(matches, teamId, targetDateStr = null) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;

  matches.forEach((m, idx) => {
    if (idx >= 8) return;

    let diffDays = 4;
    if (m.date) {
      const matchDate = new Date(m.date);
      const diffMs = targetDate - matchDate;
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }

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
 * Calculate weighted venue-specific rolling stats
 * homeVenueMatches: only matches where team played at HOME (as home_team_id)
 * awayVenueMatches: only matches where team played AWAY (as away_team_id)
 * These are pre-filtered in the route/backtest before calling predict()
 */
function calcVenueSpecificStats(venueMatches, teamId, isHomeRole, targetDateStr = null) {
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

    const w = Math.exp(-0.0065 * diffDays);

    // In venue-specific matches, isHomeRole tells us the perspective
    const gs = isHomeRole ? m.score_home : m.score_away;
    const ga = isHomeRole ? m.score_away : m.score_home;

    weightedGoalsScored += gs * w;
    weightedGoalsConceded += ga * w;
    totalWeight += w;
  });

  if (totalWeight === 0) return null; // not enough data
  return {
    avgScored: weightedGoalsScored / totalWeight,
    avgConceded: weightedGoalsConceded / totalWeight,
  };
}

/**
 * Compute attack/defence strengths from average goals
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
 */
function blendEloAdjustment(probs, eloHomeWinProb) {
  const POISSON_WEIGHT = 0.70;
  const ELO_WEIGHT = 0.30;

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
 * @param {object} params.homeStats
 * @param {object} params.awayStats
 * @param {Array}  params.homeRecentMatches      - 8 mixed recent matches (home+away) for home team
 * @param {Array}  params.awayRecentMatches      - 8 mixed recent matches for away team
 * @param {Array}  params.homeHomeRecentMatches  - 6 home-venue-only matches for home team [UPGRADE 1]
 * @param {Array}  params.awayAwayRecentMatches  - 6 away-venue-only matches for away team [UPGRADE 1]
 * @param {number} params.homeTeamId
 * @param {number} params.awayTeamId
 * @param {number} params.homeElo
 * @param {number} params.awayElo
 * @param {number} params.leagueAvgHome
 * @param {number} params.leagueAvgAway
 * @param {object} params.situationalFactors
 * @param {number} params.h2hAvgGoals
 * @param {Array}  params.h2hRecentResults       - last 5 h2h match results for probability adjustment [UPGRADE 3]
 * @param {number} params.homeRestDays
 * @param {number} params.awayRestDays
 * @param {number} params.homeWinRate
 * @param {string} params.matchDate
 * @param {boolean} params.isNeutral             - true for World Cup / neutral venue [UPGRADE 2]
 */
export function predict(params) {
  const {
    homeStats = { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 21, xGA: 14 },
    awayStats = { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 16, xGA: 21 },
    homeRecentMatches = [],
    awayRecentMatches = [],
    homeHomeRecentMatches = [],  // Upgrade 1
    awayAwayRecentMatches = [],  // Upgrade 1
    homeTeamId,
    awayTeamId,
    homeElo = 1500,
    awayElo = 1500,
    leagueAvgHome = 1.5,
    leagueAvgAway = 1.2,
    situationalFactors = {},
    h2hAvgGoals = 0,
    h2hRecentResults = [],       // Upgrade 3: [{homeGoals, awayGoals}]
    homeRestDays = 4,
    awayRestDays = 4,
    homeWinRate = 0.5,
    matchDate = null,
    isNeutral = false,           // Upgrade 2: World Cup neutral venue
  } = params;

  const homeIdNum = homeTeamId !== undefined && homeTeamId !== null ? Number(homeTeamId) : null;
  const awayIdNum = awayTeamId !== undefined && awayTeamId !== null ? Number(awayTeamId) : null;

  const targetDateStr = matchDate || (homeRecentMatches[0]?.date ? homeRecentMatches[0].date : null);

  // ─── Step 1: Calculate rolling stats (general — all recent matches) ────────
  let homeRollingAll = { avgScored: 1.2, avgConceded: 1.2 };
  let awayRollingAll = { avgScored: 1.2, avgConceded: 1.2 };

  if (homeRecentMatches && homeRecentMatches.length > 0 && homeIdNum !== null) {
    homeRollingAll = calcWeightedRollingStats(homeRecentMatches, homeIdNum, targetDateStr);
  } else if (homeStats) {
    const stats = getXGStats(homeStats);
    homeRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  if (awayRecentMatches && awayRecentMatches.length > 0 && awayIdNum !== null) {
    awayRollingAll = calcWeightedRollingStats(awayRecentMatches, awayIdNum, targetDateStr);
  } else if (awayStats) {
    const stats = getXGStats(awayStats);
    awayRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  // ─── Step 2: Venue-specific stats (Upgrade 1) ─────────────────────────────
  // Only use venue-split if NOT a neutral venue match
  let homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded;

  if (!isNeutral && homeHomeRecentMatches && homeHomeRecentMatches.length >= 3) {
    // Home team's performance specifically at home
    const venueHome = calcVenueSpecificStats(homeHomeRecentMatches, homeIdNum, true, targetDateStr);
    if (venueHome) {
      // Blend: 50% venue-specific + 30% rolling-all + 20% league average
      homeAvgScored   = 0.50 * venueHome.avgScored   + 0.30 * homeRollingAll.avgScored   + 0.20 * leagueAvgHome;
      homeAvgConceded = 0.50 * venueHome.avgConceded + 0.30 * homeRollingAll.avgConceded + 0.20 * leagueAvgAway;
      console.log(`[Predictor] HOME venue-specific: scored=${venueHome.avgScored.toFixed(3)}, conceded=${venueHome.avgConceded.toFixed(3)}`);
    } else {
      homeAvgScored   = homeRollingAll.avgScored;
      homeAvgConceded = homeRollingAll.avgConceded;
    }
  } else {
    // Neutral venue or insufficient venue data: use rolling-all
    homeAvgScored   = homeRollingAll.avgScored;
    homeAvgConceded = homeRollingAll.avgConceded;
  }

  if (!isNeutral && awayAwayRecentMatches && awayAwayRecentMatches.length >= 3) {
    // Away team's performance specifically away from home
    const venueAway = calcVenueSpecificStats(awayAwayRecentMatches, awayIdNum, false, targetDateStr);
    if (venueAway) {
      // Blend: 50% venue-specific + 30% rolling-all + 20% league average
      awayAvgScored   = 0.50 * venueAway.avgScored   + 0.30 * awayRollingAll.avgScored   + 0.20 * leagueAvgAway;
      awayAvgConceded = 0.50 * venueAway.avgConceded + 0.30 * awayRollingAll.avgConceded + 0.20 * leagueAvgHome;
      console.log(`[Predictor] AWAY venue-specific: scored=${venueAway.avgScored.toFixed(3)}, conceded=${venueAway.avgConceded.toFixed(3)}`);
    } else {
      awayAvgScored   = awayRollingAll.avgScored;
      awayAvgConceded = awayRollingAll.avgConceded;
    }
  } else {
    awayAvgScored   = awayRollingAll.avgScored;
    awayAvgConceded = awayRollingAll.avgConceded;
  }

  // ─── Step 3: Bayesian Shrinkage (blend towards league mean) ───────────────
  const ROLLING_WEIGHT = 0.60;
  const MEAN_WEIGHT = 0.40;
  homeAvgScored   = homeAvgScored   * ROLLING_WEIGHT + leagueAvgHome * MEAN_WEIGHT;
  homeAvgConceded = homeAvgConceded * ROLLING_WEIGHT + leagueAvgAway * MEAN_WEIGHT;
  awayAvgScored   = awayAvgScored   * ROLLING_WEIGHT + leagueAvgAway * MEAN_WEIGHT;
  awayAvgConceded = awayAvgConceded * ROLLING_WEIGHT + leagueAvgHome * MEAN_WEIGHT;

  // ─── Step 4: Dynamic Home Advantage (Upgrade 2) ───────────────────────────
  // Neutral venue (World Cup): homeAdvantage = 1.0 (unless explicitly overridden by host/home advantage)
  // Regular match: homeAdvantage = leagueAvgHome / leagueAvgAway (from real data)
  let homeAdvantage;
  if (situationalFactors.isHomeAdvantage) {
    homeAdvantage = leagueAvgAway > 0 ? (leagueAvgHome / leagueAvgAway) : 1.25;
    homeAdvantage = Math.max(0.9, Math.min(1.5, homeAdvantage));
    console.log(`[Predictor] Home advantage override enabled — homeAdvantage = ${homeAdvantage.toFixed(4)}`);
  } else if (isNeutral) {
    homeAdvantage = 1.0;
    console.log(`[Predictor] Neutral venue — homeAdvantage = 1.0 (World Cup / sân trung lập)`);
  } else {
    homeAdvantage = leagueAvgAway > 0 ? (leagueAvgHome / leagueAvgAway) : 1.25;
    // Clamp to reasonable range [0.9, 1.5]
    homeAdvantage = Math.max(0.9, Math.min(1.5, homeAdvantage));
    console.log(`[Predictor] Dynamic homeAdvantage = ${homeAdvantage.toFixed(4)} (leagueAvgHome=${leagueAvgHome.toFixed(3)}, leagueAvgAway=${leagueAvgAway.toFixed(3)})`);
  }

  // Apply home advantage to home team's attack and away team's defence perspective
  const homeAvgScoredAdj   = homeAvgScored   * homeAdvantage;
  const homeAvgConcededAdj = homeAvgConceded / homeAdvantage;

  // ─── Step 5: Compute attack/defence strengths ─────────────────────────────
  // Use a single leagueAvg reference (average of home+away) for neutral,
  // or separate home/away averages for regular matches
  const refLeagueAvg = isNeutral ? ((leagueAvgHome + leagueAvgAway) / 2) : null;
  const effectiveLeagueHome = isNeutral ? refLeagueAvg : leagueAvgHome;
  const effectiveLeagueAway = isNeutral ? refLeagueAvg : leagueAvgAway;

  const { homeAttack, homeDefence, awayAttack, awayDefence } = calcStrengths(
    homeAvgScoredAdj, homeAvgConcededAdj,
    awayAvgScored, awayAvgConceded,
    effectiveLeagueHome, effectiveLeagueAway
  );

  // ─── Step 6: Compute base lambdas ─────────────────────────────────────────
  let homeLambda = calcLambda(homeAttack, awayDefence, effectiveLeagueHome);
  let awayLambda = calcLambda(awayAttack, homeDefence, effectiveLeagueAway);

  // ─── Step 7: Apply situational multipliers ────────────────────────────────
  let { homeLambda: adjHomeLambda, awayLambda: adjAwayLambda, factors } =
    applySituationalFactors({ homeLambda, awayLambda }, situationalFactors);

  console.log(`\n[Predictor] leagueAvgHome = ${leagueAvgHome.toFixed(4)}, leagueAvgAway = ${leagueAvgAway.toFixed(4)}, isNeutral = ${isNeutral}`);
  console.log(`[Predictor] Lambda HOME: ${adjHomeLambda.toFixed(4)}, Lambda AWAY: ${adjAwayLambda.toFixed(4)}`);

  if (h2hAvgGoals > 2.5) {
    adjHomeLambda *= 1.15;
    adjAwayLambda *= 1.15;
    factors.push({ factor: 'Big Match Factor (H2H bàn thắng TB > 2.5)', impact: 0.15, icon: '⚽' });
  }

  if (homeRestDays > 5) {
    adjHomeLambda *= 1.05;
    factors.push({ factor: `Đội nhà nghỉ ngơi tốt (${homeRestDays} ngày)`, impact: 0.05, icon: '🔋' });
  }
  if (awayRestDays > 5) {
    adjAwayLambda *= 1.05;
    factors.push({ factor: `Đội khách nghỉ ngơi tốt (${awayRestDays} ngày)`, impact: 0.05, icon: '🔋' });
  }

  // Lambda ceiling: cap at 3.0 goals
  adjHomeLambda = Math.min(adjHomeLambda, 3.0);
  adjAwayLambda = Math.min(adjAwayLambda, 3.0);

  // ─── Step 8: Build Bivariate Poisson score matrix ─────────────────────────
  // λ3 = 0.10: shared covariance — captures negative correlation
  // (when one team dominates, opponent defends tighter → fewer goals for both)
  let scoreMatrix = buildBivariateScoreMatrix(adjHomeLambda, adjAwayLambda, 0.10);

  // ─── Step 9: Apply Dixon-Coles correction with dynamic rho ────────────────
  const totalLambda = adjHomeLambda + adjAwayLambda;
  const rho = Math.max(-0.18, Math.min(-0.08, -0.255 + 0.05 * totalLambda));
  console.log(`[Predictor] Dynamic ρ = ${rho.toFixed(4)} (totalLambda = ${totalLambda.toFixed(4)})`);
  scoreMatrix = applyDixonColes(scoreMatrix, adjHomeLambda, adjAwayLambda, rho);

  // Normalize matrix after Dixon-Coles
  let matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) matrixSum += scoreMatrix[i][j];
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) scoreMatrix[i][j] /= matrixSum;
    }
  }

  // Mild draw boost: max +18% for very even matches
  const diffLambda = Math.abs(adjHomeLambda - adjAwayLambda);
  const maxLambda = Math.max(adjHomeLambda, adjAwayLambda);
  const evenness = Math.max(0, 1 - diffLambda / (maxLambda || 1));
  const drawBoost = 1 + (0.18 * evenness);
  for (let i = 0; i < scoreMatrix.length; i++) scoreMatrix[i][i] *= drawBoost;

  // Re-normalize after draw boost
  matrixSum = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) matrixSum += scoreMatrix[i][j];
  }
  if (matrixSum > 0) {
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) scoreMatrix[i][j] /= matrixSum;
    }
  }

  // ─── Step 10: Extract result probabilities ─────────────────────────────────
  let rawProbs = calcResultProbs(scoreMatrix);

  // ─── Step 11: H2H Direct Probability Adjustment (Upgrade 3) ───────────────
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

    // Only apply H2H adjustment if one side clearly dominates (>= 60% win rate)
    const H2H_WEIGHT = 0.20; // blend 20% H2H into Poisson probabilities
    if (h2hHomePct >= 0.6 || h2hAwayPct >= 0.6) {
      const blendedHome = (1 - H2H_WEIGHT) * rawProbs.home + H2H_WEIGHT * h2hHomePct;
      const blendedDraw = (1 - H2H_WEIGHT) * rawProbs.draw + H2H_WEIGHT * h2hDrawPct;
      const blendedAway = (1 - H2H_WEIGHT) * rawProbs.away + H2H_WEIGHT * h2hAwayPct;
      const bTotal = blendedHome + blendedDraw + blendedAway;
      rawProbs = { home: blendedHome / bTotal, draw: blendedDraw / bTotal, away: blendedAway / bTotal };
      const dominantSide = h2hHomePct >= 0.6 ? 'Đội nhà' : 'Đội khách';
      factors.push({ factor: `H2H dominance — ${dominantSide} thắng ${Math.round(Math.max(h2hHomePct, h2hAwayPct) * 100)}% lịch sử đối đầu`, impact: H2H_WEIGHT, icon: '🔁' });
      console.log(`[Predictor] H2H adj applied: home=${h2hHomePct.toFixed(2)}, draw=${h2hDrawPct.toFixed(2)}, away=${h2hAwayPct.toFixed(2)}`);
    }
  }

  // ─── Step 12: Blend with ELO adjustment ───────────────────────────────────
  const eloWinProb = eloToProbabilityAdjustment(homeElo, awayElo);
  const resultProbs = blendEloAdjustment(rawProbs, eloWinProb);

  // ─── Step 12.5: Align Score Matrix with Blended Result Probabilities ──────
  // We scale the partitions of the matrix (Home Win, Draw, Away Win) 
  // so their sums match the final blended 1X2 probabilities (resultProbs).
  let currentSumHome = 0, currentSumDraw = 0, currentSumAway = 0;
  for (let i = 0; i < scoreMatrix.length; i++) {
    for (let j = 0; j < scoreMatrix[i].length; j++) {
      if (i > j) currentSumHome += scoreMatrix[i][j];
      else if (i === j) currentSumDraw += scoreMatrix[i][j];
      else currentSumAway += scoreMatrix[i][j];
    }
  }

  // Apply scaling factors to ensure consistency
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

  // ─── Step 13: Over/Under and most likely score ────────────────────────────
  const overUnder = calcOverUnder(scoreMatrix);
  const predictedScore = getMostLikelyScoreConsistent(scoreMatrix, resultProbs);

  const expectedTotalGoals = adjHomeLambda + adjAwayLambda;
  let predictedOU = 'Xỉu';
  if (expectedTotalGoals > 2.7) {
    predictedOU = 'Tài';
  } else if (expectedTotalGoals < 2.3) {
    predictedOU = 'Xỉu';
  } else {
    predictedOU = overUnder.over > 0.5 ? 'Tài' : 'Xỉu';
  }

  const confidenceHomeStats = homeRecentMatches && homeRecentMatches.length > 0
    ? { matches_played: homeRecentMatches.length }
    : homeStats;
  const confidenceAwayStats = awayRecentMatches && awayRecentMatches.length > 0
    ? { matches_played: awayRecentMatches.length }
    : awayStats;
  const confidence = calcConfidence(resultProbs, confidenceHomeStats, confidenceAwayStats);

  // Calculate goals_last5 and clean_sheet_rate
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
    homeAdvantage: Math.round(homeAdvantage * 1000) / 1000,
    isNeutral,
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
