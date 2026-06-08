/**
 * Main Predictor — combines Poisson, Dixon-Coles, ELO and situational factors
 *
 * Upgrade 1: Venue-specific rolling stats (home team uses home-only matches, away uses away-only)
 * Upgrade 2: Dynamic home advantage (calculated from DB data, not hardcoded 1.25)
 *            + isNeutral flag for World Cup / neutral venue matches
 */

import fs from 'fs';
import path from 'path';
import { calcLambda, buildBivariateScoreMatrix, buildNegativeBinomialScoreMatrix, blendScoreMatrices, calcResultProbs, calcOverUnder, getMostLikelyScoreConsistent, getXGStats, calibrateMatrixIPF, buildFrankCopulaScoreMatrix } from './poisson.js';
import { applyDixonColes } from './dixonColes.js';
import { eloToProbabilityAdjustment } from './elo.js';
import { blendEnsemble } from './ensembleModel.js';

let OPTIMAL_CONFIG = {
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
  drawBoostMax: 0.0,
  eloLambdaDivisor: 3000
};

try {
  const configPath = path.resolve(process.cwd(), 'config/optimal_params.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    OPTIMAL_CONFIG = { ...OPTIMAL_CONFIG, ...parsed };
  }
} catch (err) {
  // silent fallback
}

const LEAGUE_AVG_GOALS = 1.5; // fallback when no real data

/**
 * Calculate weighted rolling stats (all recent matches, mixed home+away)
 * Uses exponential time-decay: w_i = e^(-0.0065 * days_since_match)
 */
function calcWeightedRollingStats(matches, teamId, targetDateStr = null, decayVal = null, targetLeague = null) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;
  const decay = decayVal !== null && decayVal !== undefined ? decayVal : OPTIMAL_CONFIG.decay;

  matches.forEach((m, idx) => {
    if (idx >= 12) return;

    let diffDays = 4;
    if (m.date) {
      const matchDate = new Date(m.date);
      const diffMs = targetDate - matchDate;
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }

    // Dynamic Decay phân tầng dựa trên tính chất giải đấu (Tối ưu chuyên biệt World Cup)
    let tierFactor = 1.0;
    if (targetLeague) {
      if (m.league === targetLeague) {
        tierFactor = 0.5; // Tầng 1: Cùng giải đấu (World Cup), decay chậm để giữ độ nhạy phong độ
      } else if (['WC', 'EC'].includes(targetLeague) && !['WC', 'EC'].includes(m.league)) {
        tierFactor = 3.5; // Tầng 3: Trận giao hữu / giải phụ của ĐTQG, decay cực kỳ nhanh
      } else if (['PL', 'EC', 'CL', 'PD', 'BL1', 'SA', 'FL1', 'WC'].includes(m.league)) {
        tierFactor = 1.0; // Tầng 2: Giải đấu lớn chính thức khác
      } else {
        tierFactor = 2.0; // Tầng 3: Trận giao hữu hoặc giải đấu phụ của CLB
      }
    }

    const w = Math.exp(-decay * tierFactor * diffDays);

    const isHome = Number(m.home_team_id) === Number(teamId);
    let gs, ga;
    if (m.xg_home !== undefined && m.xg_home !== null) {
      gs = isHome ? m.xg_home : m.xg_away;
      ga = isHome ? m.xg_away : m.xg_home;
    } else {
      gs = isHome ? m.score_home : m.score_away;
      ga = isHome ? m.score_away : m.score_home;
    }

    // Opponent-Adjusted Rolling Stats
    const opponentElo = isHome ? (m.away_elo ?? 1500) : (m.home_elo ?? 1500);
    const deltaE = opponentElo - 1500;
    const scoredMult = Math.max(0.5, Math.min(1.5, 1 + deltaE / 1200));
    const concededMult = Math.max(0.5, Math.min(1.5, 1 - deltaE / 1200));
    
    gs = gs * scoredMult;
    ga = ga * concededMult;

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
function calcVenueSpecificStats(venueMatches, teamId, isHomeRole, targetDateStr = null, decayVal = null, targetLeague = null) {
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  let totalWeight = 0;
  let weightedGoalsScored = 0;
  let weightedGoalsConceded = 0;
  const decay = decayVal !== null && decayVal !== undefined ? decayVal : OPTIMAL_CONFIG.decay;

  venueMatches.forEach((m, idx) => {
    if (idx >= 6) return;

    let diffDays = 4;
    if (m.date) {
      const diffMs = targetDate - new Date(m.date);
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      diffDays = days >= 0 ? days : 4;
    }

    // Dynamic Decay phân tầng dựa trên tính chất giải đấu (Tối ưu chuyên biệt World Cup)
    let tierFactor = 1.0;
    if (targetLeague) {
      if (m.league === targetLeague) {
        tierFactor = 0.5; // Tầng 1: Cùng giải đấu (World Cup), decay chậm để giữ độ nhạy phong độ
      } else if (['WC', 'EC'].includes(targetLeague) && !['WC', 'EC'].includes(m.league)) {
        tierFactor = 3.5; // Tầng 3: Trận giao hữu / giải phụ của ĐTQG, decay cực kỳ nhanh
      } else if (['PL', 'EC', 'CL', 'PD', 'BL1', 'SA', 'FL1', 'WC'].includes(m.league)) {
        tierFactor = 1.0; // Tầng 2: Giải đấu lớn chính thức khác
      } else {
        tierFactor = 2.0; // Tầng 3: Trận giao hữu hoặc giải đấu phụ của CLB
      }
    }

    const w = Math.exp(-decay * tierFactor * diffDays);

    // In venue-specific matches, isHomeRole tells us the perspective
    let gs, ga;
    if (m.xg_home !== undefined && m.xg_home !== null) {
      gs = isHomeRole ? m.xg_home : m.xg_away;
      ga = isHomeRole ? m.xg_away : m.xg_home;
    } else {
      gs = isHomeRole ? m.score_home : m.score_away;
      ga = isHomeRole ? m.score_away : m.score_home;
    }

    // Opponent-Adjusted Rolling Stats
    const opponentElo = isHomeRole ? (m.away_elo ?? 1500) : (m.home_elo ?? 1500);
    const deltaE = opponentElo - 1500;
    const scoredMult = Math.max(0.5, Math.min(1.5, 1 + deltaE / 1200));
    const concededMult = Math.max(0.5, Math.min(1.5, 1 - deltaE / 1200));
    
    gs = gs * scoredMult;
    ga = ga * concededMult;

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
function applySituationalFactors(lambdas, situationalFactors = {}, injuryFactor = {}) {
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

  // Upgrade 5: Injury/Suspension Lambda Penalty & AI Context Penalty/Motivation
  const homeAttackPen = injuryFactor.homeAttackPenalty !== undefined ? injuryFactor.homeAttackPenalty : (injuryFactor.homeReduction || 0);
  const awayAttackPen = injuryFactor.awayAttackPenalty !== undefined ? injuryFactor.awayAttackPenalty : (injuryFactor.awayReduction || 0);
  const homeDefPen = injuryFactor.homeDefensePenalty || 0;
  const awayDefPen = injuryFactor.awayDefensePenalty || 0;
  const homeMot = injuryFactor.homeMotivation !== undefined ? injuryFactor.homeMotivation : 1.0;
  const awayMot = injuryFactor.awayMotivation !== undefined ? injuryFactor.awayMotivation : 1.0;

  if (homeAttackPen > 0) {
    homeLambda *= (1 - homeAttackPen);
    factors.push({ factor: `Chấn thương hàng công đội nhà (-${Math.round(homeAttackPen * 100)}%)`, impact: -homeAttackPen, icon: '🏥' });
  }
  if (awayAttackPen > 0) {
    awayLambda *= (1 - awayAttackPen);
    factors.push({ factor: `Chấn thương hàng công đội khách (-${Math.round(awayAttackPen * 100)}%)`, impact: -awayAttackPen, icon: '🏥' });
  }
  if (homeDefPen > 0) {
    awayLambda *= (1 + homeDefPen);
    factors.push({ factor: `Hàng thủ đội nhà suy yếu (+${Math.round(homeDefPen * 100)}% cơ hội ghi bàn cho Đội khách)`, impact: homeDefPen, icon: '🛡️' });
  }
  if (awayDefPen > 0) {
    homeLambda *= (1 + awayDefPen);
    factors.push({ factor: `Hàng thủ đội khách suy yếu (+${Math.round(awayDefPen * 100)}% cơ hội ghi bàn cho Đội nhà)`, impact: awayDefPen, icon: '🛡️' });
  }
  if (homeMot !== 1.0) {
    homeLambda *= homeMot;
    const pct = Math.round((homeMot - 1) * 100);
    factors.push({ factor: `Động lực thi đấu đội nhà: ${homeMot > 1 ? '+' : ''}${pct}%`, impact: homeMot - 1, icon: homeMot > 1 ? '📈' : '📉' });
  }
  if (awayMot !== 1.0) {
    awayLambda *= awayMot;
    const pct = Math.round((awayMot - 1) * 100);
    factors.push({ factor: `Động lực thi đấu đội khách: ${awayMot > 1 ? '+' : ''}${pct}%`, impact: awayMot - 1, icon: awayMot > 1 ? '📈' : '📉' });
  }

  return { homeLambda, awayLambda, factors };
}

function blendEloAdjustment(probs, eloHomeWinProb, isNeutral = false, eloDiff = 0, customEloWeight = null) {
  let eloWeight = customEloWeight !== null && customEloWeight !== undefined ? customEloWeight : OPTIMAL_CONFIG.eloWeight;
  if (customEloWeight === null || customEloWeight === undefined) {
    if (isNeutral) {
      eloWeight = 0.50;
    } else if (Math.abs(eloDiff) > 200) {
      eloWeight = Math.min(0.60, eloWeight + 0.10);
    }
  }
  const poissonWeight = 1 - eloWeight;

  const eloHome = eloHomeWinProb;
  const eloAway = 1 - eloHomeWinProb;
  const rawDraw = probs.draw;

  const blendedHome = poissonWeight * probs.home + eloWeight * eloHome * (1 - rawDraw);
  const blendedAway = poissonWeight * probs.away + eloWeight * eloAway * (1 - rawDraw);
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
function getConfederation(teamName) {
  if (!teamName) return 'OTHER';
  const name = teamName.toLowerCase();
  
  // UEFA
  if (/france|england|spain|portugal|germany|italy|netherlands|belgium|croatia|switzerland|denmark|austria|turkey|ukraine|poland|scotland|wales|sweden|serbia|slovenia|romania|slovakia|czech|hungary|georgia|albania|norway|greece|ireland|finland|iceland/i.test(name)) {
    return 'UEFA';
  }
  // CONMEBOL
  if (/argentina|brazil|uruguay|colombia|ecuador|paraguay|chile|peru|venezuela|bolivia/i.test(name)) {
    return 'CONMEBOL';
  }
  // CONCACAF
  if (/united states|usa|mexico|canada|costa rica|panama|jamaica|honduras|el salvador|haiti/i.test(name)) {
    return 'CONCACAF';
  }
  // AFC
  if (/japan|south korea|korea|iran|saudi arabia|australia|qatar|uzbekistan|iraq|united arab emirates|uae|jordan|oman|china|vietnam|thailand|indonesia|malaysia/i.test(name)) {
    return 'AFC';
  }
  // CAF
  if (/senegal|morocco|algeria|egypt|nigeria|ivory coast|ghana|cameroon|tunisia|mali|south africa|congo|angola|guinea|burkina faso/i.test(name)) {
    return 'CAF';
  }
  // OFC
  if (/new zealand|fiji|tahiti|new caledonia/i.test(name)) {
    return 'OFC';
  }
  
  return 'OTHER';
}

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
    isKnockout = false,          // NEW: World Cup knockout stage
    injuryFactor = {},           // Upgrade 5: injury/suspension lambda penalty
    dixonColesStrengths = null,
    weather = 'fine',
    referee = 'normal',
    decay = OPTIMAL_CONFIG.decay,
    mleWeight = OPTIMAL_CONFIG.mleWeight,
    rollingWeight = OPTIMAL_CONFIG.rollingWeight,
    xgWeight = OPTIMAL_CONFIG.xgWeight,
    rollingWeightNonDC = OPTIMAL_CONFIG.rollingWeightNonDC,
    xgWeightNonDC = OPTIMAL_CONFIG.xgWeightNonDC,
    meanWeightNonDC = OPTIMAL_CONFIG.meanWeightNonDC,
    eloWeight = OPTIMAL_CONFIG.eloWeight,
    bivariateWeight = OPTIMAL_CONFIG.bivariateWeight,
    nbR = OPTIMAL_CONFIG.nbR,
    lambda3 = 0.02,
    rhoVal = null,
    drawBoostMax = OPTIMAL_CONFIG.drawBoostMax,
    homeAdvFactor = OPTIMAL_CONFIG.homeAdvFactor,
    eloLambdaDivisor = OPTIMAL_CONFIG.eloLambdaDivisor,
    targetLeague = null,
    homeTeamName = null,
    awayTeamName = null,
    venueCondition = 'normal',
    travelData = null,
    groupScenario = 'normal',
  } = params;

  const homeIdNum = homeTeamId !== undefined && homeTeamId !== null ? Number(homeTeamId) : null;
  const awayIdNum = awayTeamId !== undefined && awayTeamId !== null ? Number(awayTeamId) : null;

  const targetDateStr = matchDate || (homeRecentMatches[0]?.date ? homeRecentMatches[0].date : null);

  // ─── Confederation ELO Adjustment ─────────────────────────────────────────
  let adjHomeElo = homeElo;
  let adjAwayElo = awayElo;
  const confFactors = [];
  
  const homeConf = homeTeamName ? getConfederation(homeTeamName) : 'OTHER';
  const awayConf = awayTeamName ? getConfederation(awayTeamName) : 'OTHER';

  if (targetLeague === 'WC' && homeTeamName && awayTeamName) {
    const CONF_ELO_BOOST = {
      'UEFA': 75,
      'CONMEBOL': 75,
      'CONCACAF': 0,
      'CAF': -20,
      'AFC': -30,
      'OFC': -75,
      'OTHER': 0
    };
    
    const homeBoost = CONF_ELO_BOOST[homeConf] || 0;
    const awayBoost = CONF_ELO_BOOST[awayConf] || 0;
    
    adjHomeElo += homeBoost;
    adjAwayElo += awayBoost;
    
    if (homeBoost !== 0 || awayBoost !== 0) {
      console.log(`[Confederation ELO] Boosted ELOs: ${homeTeamName} (${homeConf}: ${homeElo} -> ${adjHomeElo}), ${awayTeamName} (${awayConf}: ${awayElo} -> ${adjAwayElo})`);
      const eloDiffBoost = (homeBoost - awayBoost);
      confFactors.push({
        factor: `Đẳng cấp Liên đoàn (${homeConf} vs ${awayConf}): ${eloDiffBoost >= 0 ? 'Đội nhà' : 'Đội khách'} nhận lợi thế đẳng cấp ${Math.abs(eloDiffBoost)} ELO ảo`,
        impact: Math.round((eloDiffBoost / 1000) * 100) / 100,
        icon: '⚖️'
      });
    }
  }

  // ─── Climate & Altitude ELO & xG Adjustment ──────────────────────────────
  let venueGoalsPenalty = 1.0;
  let homeTravelGoalsPenalty = 1.0;
  let awayTravelGoalsPenalty = 1.0;
  if (venueCondition === 'high_altitude') {
    venueGoalsPenalty = 0.92;
    if (homeConf !== 'CONMEBOL') {
      adjHomeElo -= 60;
      confFactors.push({
        factor: `Độ cao lớn (Mexico City >2000m): ${homeTeamName || 'Đội nhà'} không quen độ cao (-60 ELO ảo)`,
        impact: -0.06,
        icon: '⛰️'
      });
    }
    if (awayConf !== 'CONMEBOL') {
      adjAwayElo -= 60;
      confFactors.push({
        factor: `Độ cao lớn (Mexico City >2000m): ${awayTeamName || 'Đội khách'} không quen độ cao (-60 ELO ảo)`,
        impact: -0.06,
        icon: '⛰️'
      });
    }
    confFactors.push({
      factor: `Ảnh hưởng độ cao lớn: Giảm 8% bàn thắng kỳ vọng cả hai đội`,
      impact: -0.08,
      icon: '⛰️'
    });
  } else if (venueCondition === 'hot_humid') {
    venueGoalsPenalty = 0.94;
    if (homeConf === 'UEFA') {
      adjHomeElo -= 40;
      confFactors.push({
        factor: `Nắng nóng ẩm cực đoan (Miami/Houston/Dallas): ${homeTeamName || 'Đội nhà'} (UEFA) chịu phạt nhiệt độ (-40 ELO ảo)`,
        impact: -0.04,
        icon: '🌡️'
      });
    }
    if (awayConf === 'UEFA') {
      adjAwayElo -= 40;
      confFactors.push({
        factor: `Nắng nóng ẩm cực đoan (Miami/Houston/Dallas): ${awayTeamName || 'Đội khách'} (UEFA) chịu phạt nhiệt độ (-40 ELO ảo)`,
        impact: -0.04,
        icon: '🌡️'
      });
    }
    confFactors.push({
      factor: `Ảnh hưởng thời tiết nóng ẩm: Giảm 6% bàn thắng kỳ vọng cả hai đội`,
      impact: -0.06,
      icon: '🌡️'
    });
  }

  // ─── Travel & Jet Lag ELO & xG Adjustment ────────────────────────────────
  if (travelData && travelData.currentCity) {
    const WC26_CITIES = {
      vancouver: { name: 'Vancouver (Canada)', lat: 49.2827, lon: -123.1207, utcOffset: -7 },
      toronto: { name: 'Toronto (Canada)', lat: 43.6532, lon: -79.3832, utcOffset: -4 },
      seattle: { name: 'Seattle (USA)', lat: 47.6062, lon: -122.3321, utcOffset: -7 },
      san_francisco: { name: 'San Francisco (USA)', lat: 37.3541, lon: -121.9552, utcOffset: -7 },
      los_angeles: { name: 'Los Angeles (USA)', lat: 34.0522, lon: -118.2437, utcOffset: -7 },
      guadalajara: { name: 'Guadalajara (Mexico)', lat: 20.6597, lon: -103.3496, utcOffset: -6 },
      mexico_city: { name: 'Mexico City (Mexico)', lat: 19.4326, lon: -99.1332, utcOffset: -6 },
      monterrey: { name: 'Monterrey (Mexico)', lat: 25.6866, lon: -100.3161, utcOffset: -6 },
      houston: { name: 'Houston (USA)', lat: 29.7604, lon: -95.3698, utcOffset: -5 },
      dallas: { name: 'Dallas (USA)', lat: 32.7767, lon: -96.7970, utcOffset: -5 },
      kansas_city: { name: 'Kansas City (USA)', lat: 39.0997, lon: -94.5786, utcOffset: -5 },
      atlanta: { name: 'Atlanta (USA)', lat: 33.7490, lon: -84.3880, utcOffset: -4 },
      miami: { name: 'Miami (USA)', lat: 25.7617, lon: -80.1918, utcOffset: -4 },
      boston: { name: 'Boston (USA)', lat: 42.3601, lon: -71.0589, utcOffset: -4 },
      philadelphia: { name: 'Philadelphia (USA)', lat: 39.9526, lon: -75.1652, utcOffset: -4 },
      new_york: { name: 'New York/New Jersey (USA)', lat: 40.7128, lon: -74.0060, utcOffset: -4 }
    };

    function calcHaversine(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const currentLoc = WC26_CITIES[travelData.currentCity];

    if (currentLoc) {
      // 1. Home Team Travel
      if (travelData.homeLastCity && travelData.homeLastCity !== travelData.currentCity) {
        const lastLoc = WC26_CITIES[travelData.homeLastCity];
        if (lastLoc) {
          const dist = calcHaversine(lastLoc.lat, lastLoc.lon, currentLoc.lat, currentLoc.lon);
          const tzDiff = Math.abs(lastLoc.utcOffset - currentLoc.utcOffset);
          
          let homeEloPenalty = Math.round((dist / 1000) * 10) + (tzDiff * 10);
          homeEloPenalty = Math.min(homeEloPenalty, 70); // cap at 70 ELO
          adjHomeElo -= homeEloPenalty;

          let homeXgPenalty = 0;
          if (dist > 3500) homeXgPenalty += 0.06;
          else if (dist > 1500) homeXgPenalty += 0.03;

          if (tzDiff >= 3) homeXgPenalty += 0.04;
          else if (tzDiff >= 2) homeXgPenalty += 0.02;

          homeXgPenalty = Math.min(homeXgPenalty, 0.08); // cap at 8%
          homeTravelGoalsPenalty = 1 - homeXgPenalty;

          confFactors.push({
            factor: `Di chuyển đội nhà (${lastLoc.name.split(' ')[0]} ➔ ${currentLoc.name.split(' ')[0]}): Bay ${Math.round(dist)}km, lệch ${tzDiff} múi giờ (phạt -${homeEloPenalty} ELO ảo & -${Math.round(homeXgPenalty * 100)}% xG)`,
            impact: -Math.round(homeXgPenalty * 100) / 100,
            icon: '✈️'
          });
        }
      }

      // 2. Away Team Travel
      if (travelData.awayLastCity && travelData.awayLastCity !== travelData.currentCity) {
        const lastLoc = WC26_CITIES[travelData.awayLastCity];
        if (lastLoc) {
          const dist = calcHaversine(lastLoc.lat, lastLoc.lon, currentLoc.lat, currentLoc.lon);
          const tzDiff = Math.abs(lastLoc.utcOffset - currentLoc.utcOffset);

          let awayEloPenalty = Math.round((dist / 1000) * 10) + (tzDiff * 10);
          awayEloPenalty = Math.min(awayEloPenalty, 70); // cap at 70 ELO
          adjAwayElo -= awayEloPenalty;

          let awayXgPenalty = 0;
          if (dist > 3500) awayXgPenalty += 0.06;
          else if (dist > 1500) awayXgPenalty += 0.03;

          if (tzDiff >= 3) awayXgPenalty += 0.04;
          else if (tzDiff >= 2) awayXgPenalty += 0.02;

          awayXgPenalty = Math.min(awayXgPenalty, 0.08); // cap at 8%
          awayTravelGoalsPenalty = 1 - awayXgPenalty;

          confFactors.push({
            factor: `Di chuyển đội khách (${lastLoc.name.split(' ')[0]} ➔ ${currentLoc.name.split(' ')[0]}): Bay ${Math.round(dist)}km, lệch ${tzDiff} múi giờ (phạt -${awayEloPenalty} ELO ảo & -${Math.round(awayXgPenalty * 100)}% xG)`,
            impact: -Math.round(awayXgPenalty * 100) / 100,
            icon: '✈️'
          });
        }
      }
    }
  }

  // ─── Step 1: Calculate rolling stats (general — all recent matches) ────────
  let homeRollingAll = { avgScored: 1.2, avgConceded: 1.2 };
  let awayRollingAll = { avgScored: 1.2, avgConceded: 1.2 };

  if (homeRecentMatches && homeRecentMatches.length > 0 && homeIdNum !== null) {
    homeRollingAll = calcWeightedRollingStats(homeRecentMatches, homeIdNum, targetDateStr, decay, targetLeague);
  } else if (homeStats) {
    const stats = getXGStats(homeStats);
    homeRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  if (awayRecentMatches && awayRecentMatches.length > 0 && awayIdNum !== null) {
    awayRollingAll = calcWeightedRollingStats(awayRecentMatches, awayIdNum, targetDateStr, decay, targetLeague);
  } else if (awayStats) {
    const stats = getXGStats(awayStats);
    awayRollingAll = { avgScored: stats.avgScored, avgConceded: stats.avgConceded };
  }

  // ─── Step 2: Venue-specific stats (Upgrade 1) ─────────────────────────────
  // Only use venue-split if NOT a neutral venue match
  let homeAvgScored, homeAvgConceded, awayAvgScored, awayAvgConceded;

  if (!isNeutral && homeHomeRecentMatches && homeHomeRecentMatches.length >= 3) {
    // Home team's performance specifically at home
    const venueHome = calcVenueSpecificStats(homeHomeRecentMatches, homeIdNum, true, targetDateStr, decay, targetLeague);
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
    const venueAway = calcVenueSpecificStats(awayAwayRecentMatches, awayIdNum, false, targetDateStr, decay, targetLeague);
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

  // Lấy dữ liệu xG trung bình cả mùa giải từ Understat làm trọng số thực lực
  const homeXG = getXGStats(homeStats);
  const awayXG = getXGStats(awayStats);

  // ─── Step 3: Bayesian Shrinkage (blend phong độ, xG cả mùa, trung bình giải đấu và Dixon-Coles MLE) ───
  if (dixonColesStrengths && dixonColesStrengths.strengths) {
    const homeDC = dixonColesStrengths.strengths[homeIdNum] || { attack: 1.0, defence: 1.0 };
    const awayDC = dixonColesStrengths.strengths[awayIdNum] || { attack: 1.0, defence: 1.0 };

    const homeDCScored = homeDC.attack * leagueAvgHome;
    const homeDCConceded = homeDC.defence * leagueAvgAway;
    const awayDCScored = awayDC.attack * leagueAvgAway;
    const awayDCConceded = awayDC.defence * leagueAvgHome;

    homeAvgScored   = homeAvgScored   * rollingWeight + homeXG.avgScored   * xgWeight + homeDCScored   * mleWeight;
    homeAvgConceded = homeAvgConceded * rollingWeight + homeXG.avgConceded * xgWeight + homeDCConceded * mleWeight;
    awayAvgScored   = awayAvgScored   * rollingWeight + awayXG.avgScored   * xgWeight + awayDCScored   * mleWeight;
    awayAvgConceded = awayAvgConceded * rollingWeight + awayXG.avgConceded * xgWeight + awayDCConceded * mleWeight;
  } else {
    // Fallback if Dixon-Coles strengths are not supplied (e.g. non-season matches)
    homeAvgScored   = homeAvgScored   * rollingWeightNonDC + homeXG.avgScored   * xgWeightNonDC + leagueAvgHome * meanWeightNonDC;
    homeAvgConceded = homeAvgConceded * rollingWeightNonDC + homeXG.avgConceded * xgWeightNonDC + leagueAvgAway * meanWeightNonDC;
    awayAvgScored   = awayAvgScored   * rollingWeightNonDC + awayXG.avgScored   * xgWeightNonDC + leagueAvgAway * meanWeightNonDC;
    awayAvgConceded = awayAvgConceded * rollingWeightNonDC + awayXG.avgConceded * xgWeightNonDC + leagueAvgHome * meanWeightNonDC;
  }

  // ─── Step 4: Dynamic Home Advantage (Upgrade 2) ───────────────────────────
  // Neutral venue (World Cup): homeAdvantage = 1.0 (unless explicitly overridden by host/home advantage)
  // Regular match: homeAdvantage = leagueAvgHome / leagueAvgAway (from real data)
  let homeAdvantage;
  const WC_HOST_IDS = [769, 771, 828]; // Mexico, United States, Canada
  const WC_HOST_NAMES = ['United States', 'USA', 'Mexico', 'Canada'];
  const isHomeHost = WC_HOST_IDS.includes(Number(homeIdNum)) || 
                     (homeTeamName && WC_HOST_NAMES.includes(homeTeamName));

  if (situationalFactors.isHomeAdvantage) {
    homeAdvantage = leagueAvgAway > 0 ? (leagueAvgHome / leagueAvgAway) : 1.25;
    homeAdvantage = Math.max(0.9, Math.min(1.5, homeAdvantage * homeAdvFactor));
    console.log(`[Predictor] Home advantage override enabled — homeAdvantage = ${homeAdvantage.toFixed(4)}`);
  } else if (isNeutral) {
    if (targetLeague === 'WC' && isHomeHost) {
      homeAdvantage = 1.10;
      console.log(`[Predictor] WC Host Advantage applied for host team — homeAdvantage = 1.10`);
    } else {
      homeAdvantage = 1.0;
      console.log(`[Predictor] Neutral venue — homeAdvantage = 1.0 (World Cup / sân trung lập)`);
    }
  } else {
    const rawHomeAdv = leagueAvgAway > 0 ? (leagueAvgHome / leagueAvgAway) : 1.25;
    if (dixonColesStrengths && dixonColesStrengths.homeAdv) {
      // Blend 50% raw ratio and 50% simultaneous MLE solved home advantage
      homeAdvantage = 0.50 * rawHomeAdv + 0.50 * dixonColesStrengths.homeAdv;
    } else {
      homeAdvantage = rawHomeAdv;
    }
    // Clamp to reasonable range [0.9, 1.5] and apply tuning factor homeAdvFactor
    homeAdvantage = Math.max(0.9, Math.min(1.5, homeAdvantage * homeAdvFactor));
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

  // ─── Step 6.5: Form Momentum Factor (Upgrade 6) ──────────────────────────
  // If last 3 matches are all wins → +5% boost; all losses → -5% penalty
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
    if (wins === 3) return 1.05;   // hot streak
    if (losses === 3) return 0.95; // cold streak
    return 1.0;
  }

  const homeFormMult = calcFormMomentum(homeRecentMatches, homeIdNum);
  const awayFormMult = calcFormMomentum(awayRecentMatches, awayIdNum);
  homeLambda *= homeFormMult;
  awayLambda *= awayFormMult;

  // ─── Step 6.6: ELO-driven expected goals adjustment (Hướng 2) ──────────
  let eloAdjHome = 1.0;
  let eloAdjAway = 1.0;
  const eloDiff = Number(adjHomeElo) - Number(adjAwayElo);
  if (eloLambdaDivisor && eloLambdaDivisor > 0) {
    eloAdjHome = Math.max(0.5, Math.min(1.8, 1 + eloDiff / eloLambdaDivisor));
    eloAdjAway = Math.max(0.5, Math.min(1.8, 1 - eloDiff / eloLambdaDivisor));
    homeLambda *= eloAdjHome;
    awayLambda *= eloAdjAway;
  }

  // ─── Step 6.7: H2H-driven expected goals adjustment (Stylistic H2H - Hướng B) ───
  let h2hScaleHome = 1.0;
  let h2hScaleAway = 1.0;
  if (h2hRecentResults && h2hRecentResults.length >= 2) {
    const h2hCount = h2hRecentResults.length;
    const h2hHomeGoalsSum = h2hRecentResults.reduce((sum, r) => sum + r.homeGoals, 0);
    const h2hAwayGoalsSum = h2hRecentResults.reduce((sum, r) => sum + r.awayGoals, 0);
    const h2hHomeAvg = h2hHomeGoalsSum / h2hCount;
    const h2hAwayAvg = h2hAwayGoalsSum / h2hCount;

    // Bayesian scale factor to smooth out small sample sizes (prior of 2.0 goals)
    const priorGoals = 2.0;
    h2hScaleHome = (h2hHomeAvg + priorGoals) / (homeLambda + priorGoals);
    h2hScaleAway = (h2hAwayAvg + priorGoals) / (awayLambda + priorGoals);

    // Clamping to ensure stability [0.75, 1.35]
    h2hScaleHome = Math.max(0.75, Math.min(1.35, h2hScaleHome));
    h2hScaleAway = Math.max(0.75, Math.min(1.35, h2hScaleAway));

    homeLambda *= h2hScaleHome;
    awayLambda *= h2hScaleAway;
  }

  // ─── Step 7: Apply situational multipliers ────────────────────────────────
  let { homeLambda: adjHomeLambda, awayLambda: adjAwayLambda, factors } =
    applySituationalFactors({ homeLambda, awayLambda }, situationalFactors, injuryFactor);

  if (venueGoalsPenalty !== 1.0) {
    adjHomeLambda *= venueGoalsPenalty;
    adjAwayLambda *= venueGoalsPenalty;
  }

  // Apply Travel xG penalties
  if (typeof homeTravelGoalsPenalty !== 'undefined' && homeTravelGoalsPenalty !== 1.0) {
    adjHomeLambda *= homeTravelGoalsPenalty;
  }
  if (typeof awayTravelGoalsPenalty !== 'undefined' && awayTravelGoalsPenalty !== 1.0) {
    adjAwayLambda *= awayTravelGoalsPenalty;
  }

  // ─── Step 7.5: Apply Group Stage Game Theory Scenario Modulator ───────────
  if (groupScenario && groupScenario !== 'normal') {
    if (groupScenario === 'home_qualified_rotation') {
      adjHomeLambda *= 0.75;
      adjAwayLambda *= 1.10;
      factors.push({
        factor: 'Động lực vòng bảng: Đội nhà đã chắc suất đi tiếp, xoay tua đội hình (-25% công Đội nhà, +10% cơ hội cho Đội khách)',
        impact: -0.25,
        icon: '🔄'
      });
    } else if (groupScenario === 'away_qualified_rotation') {
      adjAwayLambda *= 0.75;
      adjHomeLambda *= 1.10;
      factors.push({
        factor: 'Động lực vòng bảng: Đội khách đã chắc suất đi tiếp, xoay tua đội hình (-25% công Đội khách, +10% cơ hội cho Đội nhà)',
        impact: -0.25,
        icon: '🔄'
      });
    } else if (groupScenario === 'home_must_win_big') {
      adjHomeLambda *= 1.20;
      adjAwayLambda *= 1.30;
      factors.push({
        factor: 'Động lực vòng bảng: Đội nhà buộc phải thắng đậm, dâng cao tấn công tổng lực (+20% công Đội nhà, hàng thủ lỏng lẻo dâng cao khiến đối thủ nhận +30% xG)',
        impact: 0.20,
        icon: '🏹'
      });
    } else if (groupScenario === 'away_must_win_big') {
      adjAwayLambda *= 1.20;
      adjHomeLambda *= 1.30;
      factors.push({
        factor: 'Động lực vòng bảng: Đội khách buộc phải thắng đậm, tấn công tổng lực (+20% công Đội khách, hàng thủ lỏng lẻo dâng cao khiến đối thủ nhận +30% xG)',
        impact: 0.20,
        icon: '🏹'
      });
    } else if (groupScenario === 'collusive_draw') {
      adjHomeLambda *= 0.85;
      adjAwayLambda *= 0.85;
      factors.push({
        factor: 'Động lực vòng bảng: Cả hai đội chỉ cần hòa để dắt tay nhau đi tiếp (Giảm -15% bàn thắng kỳ vọng cả hai bên, tăng mạnh xác suất hòa 0-0/1-1)',
        impact: -0.15,
        icon: '🤝'
      });
    }
  }

  // Gộp các yếu tố hiệu chỉnh Liên đoàn & Khí hậu/Địa hình
  if (confFactors.length > 0) {
    factors = factors || [];
    factors.push(...confFactors);
  }

  if (eloLambdaDivisor && eloLambdaDivisor > 0 && Math.abs(eloDiff) > 50) {
    factors.push({
      factor: `Chênh lệch ELO (${adjHomeElo} vs ${adjAwayElo}) điều chỉnh bàn thắng kỳ vọng: Đội nhà ${eloAdjHome > 1 ? '+' : ''}${Math.round((eloAdjHome - 1) * 100)}% / Đội khách ${eloAdjAway > 1 ? '+' : ''}${Math.round((eloAdjAway - 1) * 100)}%`,
      impact: Math.round((eloAdjHome - 1) * 100) / 100,
      icon: '⚖️'
    });
  }

  if (isNeutral && targetLeague === 'WC' && isHomeHost) {
    factors.push({
      factor: 'Lợi thế quốc gia chủ nhà World Cup 2026',
      impact: 0.10,
      icon: '🏠'
    });
  }

  if (h2hRecentResults && h2hRecentResults.length >= 2) {
    if (Math.abs(h2hScaleHome - 1.0) >= 0.03 || Math.abs(h2hScaleAway - 1.0) >= 0.03) {
      const homePct = Math.round((h2hScaleHome - 1) * 100);
      const awayPct = Math.round((h2hScaleAway - 1) * 100);
      
      let factorDesc = `Lịch sử đối đầu (H2H - ${h2hRecentResults.length} trận): `;
      if (homePct !== 0) factorDesc += `Đội nhà ${homePct > 0 ? '+' : ''}${homePct}% hiệu suất ghi bàn; `;
      if (awayPct !== 0) factorDesc += `Đội khách ${awayPct > 0 ? '+' : ''}${awayPct}% hiệu suất ghi bàn; `;
      factorDesc = factorDesc.trim().replace(/;$/, '');

      factors.push({
        factor: factorDesc,
        impact: Math.round((h2hScaleHome - 1) * 100) / 100,
        icon: '⚔️'
      });
      console.log(`[Predictor] H2H Goal Scaling applied: homeScale=${h2hScaleHome.toFixed(3)}, awayScale=${h2hScaleAway.toFixed(3)}`);
    }
  }

  if (isKnockout) {
    factors.push({ factor: 'Trận loại trực tiếp (Knockout) - Tăng tỷ lệ giằng co chặt chẽ', impact: 0.10, icon: '⚔️' });
  }

  // Apply Weather and Referee environmental factors
  if (weather === 'heavy_rain' || weather === 'snowy') {
    adjHomeLambda *= 0.88;
    adjAwayLambda *= 0.88;
    factors.push({ factor: `Thời tiết xấu (${weather === 'heavy_rain' ? 'Mưa lớn' : 'Tuyết/Lạnh giá'}) giảm bàn thắng kỳ vọng (-12%)`, impact: -0.12, icon: '🌧️' });
  } else if (weather === 'windy') {
    adjHomeLambda *= 0.94;
    adjAwayLambda *= 0.94;
    factors.push({ factor: 'Thời tiết gió mạnh ảnh hưởng lối chơi bóng ngắn (-6%)', impact: -0.06, icon: '💨' });
  }

  if (referee === 'strict') {
    adjHomeLambda *= 1.06;
    adjAwayLambda *= 1.06;
    factors.push({ factor: 'Trọng tài nghiêm khắc (Strict): Tăng cơ hội penalty và thẻ phạt (+6% bàn thắng kỳ vọng)', impact: 0.06, icon: '🟨' });
  } else if (referee === 'lenient') {
    adjHomeLambda *= 0.93;
    adjAwayLambda *= 0.93;
    factors.push({ factor: 'Trọng tài khoan dung (Lenient): Lối chơi thể lực tự do, ít thổi còi (-7% bàn thắng kỳ vọng)', impact: -0.07, icon: '⚖️' });
  } else if (referee === 'home_biased') {
    if (isNeutral) {
      const isHomeHost = ['Mexico', 'United States', 'Canada', 'Mỹ'].some(h => homeTeamName && homeTeamName.includes(h));
      if (isHomeHost) {
        adjHomeLambda *= 1.06;
        adjAwayLambda *= 0.94;
        factors.push({ factor: 'Trọng tài thiên vị chủ nhà (Home Bias): Ưu ái nước chủ nhà đăng cai (+6% công, -6% thủ khách)', impact: 0.06, icon: '🚩' });
      } else {
        adjHomeLambda *= 1.03;
        adjAwayLambda *= 0.97;
        factors.push({ factor: 'Trọng tài thiên vị chủ nhà (Home Bias): Trận trung lập, ưu ái nhẹ đội chỉ định sân nhà (+3%/-3%)', impact: 0.03, icon: '🚩' });
      }
    } else {
      adjHomeLambda *= 1.05;
      adjAwayLambda *= 0.95;
      factors.push({ factor: 'Trọng tài thiên vị chủ nhà (Home Bias): Chịu áp lực khán giả sân nhà (+5% công, -5% thủ khách)', impact: 0.05, icon: '🚩' });
    }
  }

  // Log form momentum if non-neutral
  if (homeFormMult !== 1.0) factors.push({ factor: homeFormMult > 1 ? 'Đội nhà đang trong chuỗi 3 trận thắng liên tiếp 🔥' : 'Đội nhà đang trong chuỗi 3 trận thua liên tiếp', impact: homeFormMult - 1, icon: homeFormMult > 1 ? '🔥' : '📉' });
  if (awayFormMult !== 1.0) factors.push({ factor: awayFormMult > 1 ? 'Đội khách đang trong chuỗi 3 trận thắng liên tiếp 🔥' : 'Đội khách đang trong chuỗi 3 trận thua liên tiếp', impact: awayFormMult - 1, icon: awayFormMult > 1 ? '🔥' : '📉' });

  console.log(`\n[Predictor] leagueAvgHome = ${leagueAvgHome.toFixed(4)}, leagueAvgAway = ${leagueAvgAway.toFixed(4)}, isNeutral = ${isNeutral}`);
  console.log(`[Predictor] Lambda HOME: ${adjHomeLambda.toFixed(4)}, Lambda AWAY: ${adjAwayLambda.toFixed(4)}`);

  if (h2hAvgGoals > 2.5) {
    adjHomeLambda *= 1.15;
    adjAwayLambda *= 1.15;
    factors.push({ factor: 'Yếu tố trận đấu lớn (H2H bàn thắng TB > 2.5)', impact: 0.15, icon: '⚽' });
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

  // ─── Step 8: Build blended Bivariate Poisson & Negative Binomial matrix (Dynamic lambda3 — Hướng A) ───
  const eloDiffAbs = Math.abs(Number(adjHomeElo) - Number(adjAwayElo));
  const eloCorrelationFactor = 0.15 * Math.exp(-eloDiffAbs / 350);
  let effectiveLambda3 = 0.02 + eloCorrelationFactor;

  if (isKnockout) {
    effectiveLambda3 += 0.10; // Tăng thêm 0.10 cho trận Knockout giằng co
  }
  if (groupScenario === 'collusive_draw') {
    effectiveLambda3 += 0.20; // Tăng thêm 0.20 cho trận hòa thỏa hiệp
  }

  // Giới hạn lambda3 trong khoảng thực tế [0.01, 0.45]
  effectiveLambda3 = Math.max(0.01, Math.min(0.45, effectiveLambda3));
  console.log(`[Predictor] ELO-based Dynamic lambda3 = ${effectiveLambda3.toFixed(4)} (ELO diff = ${eloDiffAbs}, base=${lambda3})`);

  // Bivariate Frank Copula parameter theta derived from correlation (typical ranges [-4, 4], negative means positive relationship in target draw structure)
  // Let's dynamically scale theta based on evenness of the match
  const matchEvenness = Math.max(0, 1 - eloDiffAbs / 500); // 1 = equal teams, 0 = highly unequal teams
  let copulaTheta = -1.2 - 1.5 * matchEvenness; // dynamic theta
  if (groupScenario === 'collusive_draw') {
    copulaTheta -= 2.0; // stronger dependency for a draw
  }
  if (isKnockout) {
    copulaTheta -= 1.0; // tighter game dependency
  }

  // Build the Bivariate Frank Copula matrix using Negative Binomial margins
  const copulaMatrix = buildFrankCopulaScoreMatrix(adjHomeLambda, adjAwayLambda, copulaTheta, nbR);

  // Blend Copula and Dixon-Coles Poisson/NB for robust predictions
  const bivariateMatrix = buildBivariateScoreMatrix(adjHomeLambda, adjAwayLambda, effectiveLambda3);
  const nbMatrix = buildNegativeBinomialScoreMatrix(adjHomeLambda, adjAwayLambda, nbR); // dispersion parameter r
  let poissonNbMatrix = blendScoreMatrices(bivariateMatrix, nbMatrix, bivariateWeight);

  // Core blend: 70% Bivariate Copula (which holds superior dependency) + 30% Poisson/NB blend
  let scoreMatrix = blendScoreMatrices(copulaMatrix, poissonNbMatrix, 0.70);

  // ─── Step 9: Apply Dixon-Coles correction with dynamic rho ────────────────
  const totalLambda = adjHomeLambda + adjAwayLambda;
  const rho = rhoVal !== null && rhoVal !== undefined ? rhoVal : Math.max(-0.18, Math.min(-0.08, -0.255 + 0.05 * totalLambda));
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

  // Mild draw boost
  const diffLambda = Math.abs(adjHomeLambda - adjAwayLambda);
  const maxLambda = Math.max(adjHomeLambda, adjAwayLambda);
  const evenness = Math.max(0, 1 - diffLambda / (maxLambda || 1));
  const drawBoost = 1 + (drawBoostMax * evenness);
  for (let i = 0; i < scoreMatrix.length; i++) {
    scoreMatrix[i][i] *= drawBoost;
  }

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

  // ─── Step 9.5: Zero-Inflated Poisson (ZIP) for 0-0 ────────────────────────
  if (targetLeague === 'WC' || targetLeague === 'EC' || isKnockout || groupScenario === 'collusive_draw') {
    const eloDiffAdj = Math.abs(adjHomeElo - adjAwayElo);
    let pi = (isKnockout ? 0.08 : 0.03) * Math.exp(-eloDiffAdj / 400);
    if (groupScenario === 'collusive_draw') {
      pi += 0.12;
    }
    
    // Apply zero-inflation to matrix
    for (let i = 0; i < scoreMatrix.length; i++) {
      for (let j = 0; j < scoreMatrix[i].length; j++) {
        if (i === 0 && j === 0) {
          scoreMatrix[i][j] = pi + (1 - pi) * scoreMatrix[i][j];
        } else {
          scoreMatrix[i][j] = (1 - pi) * scoreMatrix[i][j];
        }
      }
    }
    factors.push({
      factor: `Lạm phát tỷ số 0-0 (ZIP model): Điều chỉnh tăng +${(pi * 100).toFixed(1)}% xác suất hòa không bàn thắng`,
      impact: Math.round(pi * 100) / 100,
      icon: '🛡️'
    });
    console.log(`[Predictor] ZIP applied: pi = ${pi.toFixed(4)}, new P(0,0) = ${scoreMatrix[0][0].toFixed(4)}`);
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
      factors.push({ factor: `Ưu thế đối đầu — ${dominantSide} chiếm ${Math.round(Math.max(h2hHomePct, h2hAwayPct) * 100)}% chiến thắng trong lịch sử`, impact: H2H_WEIGHT, icon: '🔁' });
      console.log(`[Predictor] H2H adj applied: home=${h2hHomePct.toFixed(2)}, draw=${h2hDrawPct.toFixed(2)}, away=${h2hAwayPct.toFixed(2)}`);
    }
  }

  // ─── Step 12: Blend with ELO adjustment ───────────────────────────────────
  const eloWinProb = eloToProbabilityAdjustment(adjHomeElo, adjAwayElo);
  let resultProbs = blendEloAdjustment(rawProbs, eloWinProb, isNeutral, adjHomeElo - adjAwayElo, eloWeight);

  // ─── Step 12.1: Ensemble Stacking Meta-Prediction ─────────────────────────
  const eloResultProbs = {
    home: eloWinProb,
    draw: 0.25, // average default draw expectation
    away: 1 - eloWinProb
  };
  resultProbs = blendEnsemble(resultProbs, eloResultProbs, null);

  // ─── Step 12.5: Calibrate Score Matrix using IPF ──────────────────────────
  // Align score matrix with both blended 1X2 and Over/Under probabilities
  const targetOU = calcOverUnder(scoreMatrix);
  scoreMatrix = calibrateMatrixIPF(scoreMatrix, resultProbs, targetOU);

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
