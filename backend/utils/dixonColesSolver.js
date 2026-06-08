import { getDatabase, queryAll } from '../db/database.js';
import fs from 'fs';
import path from 'path';

let optimalXGBlendWeight = 0.5; // default fallback if not configured
let optimalDecay = 0.0045; // default fallback if not configured

try {
  const configPath = path.resolve(process.cwd(), 'config/optimal_params.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.xGBlendWeight !== undefined) {
      optimalXGBlendWeight = Number(parsed.xGBlendWeight);
    }
    if (parsed.decay !== undefined) {
      optimalDecay = Number(parsed.decay);
    }
  }
} catch (e) {
  // silent fallback
}

/**
 * Solve ELO-weighted Dixon-Coles parameters for all teams in a league/season simultaneously
 * @param {Array} matches - array of finished matches of the league/season before target date
 * @param {Array} teamIds - array of unique team IDs
 * @param {string} targetDateStr - date of the target match to calculate days difference
 * @param {number} iterations - EM iterations (default 30 is enough to converge)
 * @param {object} eloMap - map of teamId to ELO rating
 * @param {number} xGBlendWeight - blend weight between actual goals and expected goals (0.0 = goals only, 1.0 = xG only)
 * @param {number} decayRate - decay rate for time decay (default 0.0045)
 * @param {string} targetLeague - league of the target match for tiering decay
 */
export function solveDixonColesMLE(matches, teamIds, targetDateStr, iterations = 30, eloMap = {}, xGBlendWeight = 0.5, decayRate = 0.0045, targetLeague = null) {
  if (matches.length === 0 || teamIds.length === 0) {
    // Return flat fallbacks if no data
    const fallback = {};
    teamIds.forEach(id => {
      fallback[id] = { attack: 1.0, defence: 1.0 };
    });
    return { strengths: fallback, homeAdv: 1.20 };
  }

  const targetDate = new Date(targetDateStr);

  // 1. Calculate time decay weights and opponent quality multipliers
  const weightedMatches = matches.map(m => {
    const matchDate = new Date(m.date);
    const diffMs = targetDate - matchDate;
    const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));

    // Dynamic Decay based on match tier / target league
    let tierFactor = 1.0;
    if (targetLeague === 'WC' || targetLeague === 'EC') {
      if (m.league === 'Friendly' || m.league === 'Giao hữu' || m.league === 'Friendly Match' || !m.league) {
        tierFactor = 3.5; // decays 3.5x faster
      } else if (m.league === 'WC' || m.league === 'EC' || m.league === 'World Cup' || m.league === 'Euro') {
        tierFactor = 0.5; // decays slower (very relevant matches)
      }
    } else {
      if (m.league === targetLeague) {
        tierFactor = 0.5;
      }
    }

    const weight = Math.exp(-decayRate * tierFactor * diffDays);

    const homeId = Number(m.home_team_id);
    const awayId = Number(m.away_team_id);

    // Opponent current ELO rating, default to 1500
    const homeElo = eloMap[homeId] ?? 1500;
    const awayElo = eloMap[awayId] ?? 1500;

    // Home perspective adjustments (opponent is awayElo)
    const homeScoredDelta = awayElo - 1500;
    const homeScoredMult = Math.max(0.5, Math.min(1.5, 1 + homeScoredDelta / 1200));
    const homeConcededMult = Math.max(0.5, Math.min(1.5, 1 - homeScoredDelta / 1200));

    // Away perspective adjustments (opponent is homeElo)
    const awayScoredDelta = homeElo - 1500;
    const awayScoredMult = Math.max(0.5, Math.min(1.5, 1 + awayScoredDelta / 1200));
    const awayConcededMult = Math.max(0.5, Math.min(1.5, 1 - awayScoredDelta / 1200));

    // Blend actual goals with Expected Goals (xG) if xG data exists
    const actualHomeGoals = Number(m.score_home);
    const actualAwayGoals = Number(m.score_away);

    const xgHome = (m.xg_home !== null && m.xg_home !== undefined) ? Number(m.xg_home) : null;
    const xgAway = (m.xg_away !== null && m.xg_away !== undefined) ? Number(m.xg_away) : null;

    const gs = xgHome !== null 
      ? ((1 - xGBlendWeight) * actualHomeGoals + xGBlendWeight * xgHome) 
      : actualHomeGoals;
    const ga = xgAway !== null 
      ? ((1 - xGBlendWeight) * actualAwayGoals + xGBlendWeight * xgAway) 
      : actualAwayGoals;

    return {
      homeId,
      awayId,
      gs,
      ga,
      weight,
      homeScoredMult,
      homeConcededMult,
      awayScoredMult,
      awayConcededMult
    };
  });

  // 2. Initialize parameters
  const attack = {};
  const defence = {};
  teamIds.forEach(id => {
    attack[id] = 1.0;
    defence[id] = 1.0;
  });
  let homeAdv = 1.20;

  // Prior regularization to ensure stability and smooth small data samples
  const PRIOR_ALPHA = 1.2;
  const PRIOR_BETA = 1.2;
  const PRIOR_WEIGHT = 0.15;

  // 3. EM Iterative updates
  for (let iter = 0; iter < iterations; iter++) {
    // 3.1 Update Attack strength (alpha)
    teamIds.forEach(id => {
      let num = PRIOR_ALPHA * PRIOR_WEIGHT;
      let den = PRIOR_WEIGHT;

      weightedMatches.forEach(m => {
        if (m.homeId === id) {
          // Adjust scoring by opponent strength
          num += m.weight * m.gs * m.homeScoredMult;
          den += m.weight * defence[m.awayId] * homeAdv;
        } else if (m.awayId === id) {
          num += m.weight * m.ga * m.awayScoredMult;
          den += m.weight * defence[m.homeId];
        }
      });

      attack[id] = den > 0 ? (num / den) : 1.0;
    });

    // 3.2 Update Defence weakness (beta)
    teamIds.forEach(id => {
      let num = PRIOR_BETA * PRIOR_WEIGHT;
      let den = PRIOR_WEIGHT;

      weightedMatches.forEach(m => {
        if (m.homeId === id) {
          // Adjust conceding by opponent strength
          num += m.weight * m.ga * m.homeConcededMult;
          den += m.weight * attack[m.awayId];
        } else if (m.awayId === id) {
          num += m.weight * m.gs * m.awayConcededMult;
          den += m.weight * attack[m.homeId] * homeAdv;
        }
      });

      defence[id] = den > 0 ? (num / den) : 1.0;
    });

    // 3.3 Update Home Advantage (gamma)
    let numHome = 0;
    let denHome = 0;
    weightedMatches.forEach(m => {
      // Adjust home goals scored by quality
      numHome += m.weight * m.gs * m.homeScoredMult;
      denHome += m.weight * attack[m.homeId] * defence[m.awayId];
    });
    homeAdv = denHome > 0 ? (numHome / denHome) : 1.20;
    // Clamp home advantage to realistic ranges [1.0, 1.45]
    homeAdv = Math.max(1.0, Math.min(1.45, homeAdv));

    // 3.4 Normalize attacks (sum(alpha_k) / N = 1.0)
    let sumAttack = 0;
    teamIds.forEach(id => { sumAttack += attack[id]; });
    const scale = sumAttack / teamIds.length;
    if (scale > 0) {
      teamIds.forEach(id => {
        attack[id] /= scale;
        defence[id] *= scale; // keep product alpha * beta invariant
      });
    }
  }

  const strengths = {};
  teamIds.forEach(id => {
    strengths[id] = {
      attack: attack[id],
      defence: defence[id]
    };
  });

  return { strengths, homeAdv };
}

/**
 * Load matches and solve ELO-weighted Dixon-Coles parameters dynamically
 */
export async function getDixonColesStrengths(league, season, targetDateStr, customXGBlendWeight = null, customDecay = null) {
  const db = await getDatabase();
  
  // Load finished matches of the season before the target date, including xg_home/xg_away and league
  const matches = await queryAll(db,
    `SELECT home_team_id, away_team_id, score_home, score_away, xg_home, xg_away, league, date 
     FROM matches 
     WHERE league = ? AND season = ? AND status = 'FINISHED' 
       AND score_home IS NOT NULL AND score_away IS NOT NULL AND date < ?`,
    [league, season, targetDateStr]
  );

  // Load all unique teams in the league
  const matchTeams = await queryAll(db,
    `SELECT DISTINCT home_team_id as id FROM matches WHERE league = ? AND season = ?
     UNION
     SELECT DISTINCT away_team_id as id FROM matches WHERE league = ? AND season = ?`,
    [league, season, league, season]
  );
  
  const teamIds = matchTeams.map(t => Number(t.id));
  
  // Build eloMap
  const eloMap = {};
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    const teamsData = await queryAll(db,
      `SELECT id, elo_rating FROM teams WHERE id IN (${placeholders})`,
      teamIds
    );
    teamsData.forEach(t => {
      eloMap[Number(t.id)] = t.elo_rating || 1500;
    });
  }
  
  const xGBlendWeight = customXGBlendWeight !== null ? customXGBlendWeight : optimalXGBlendWeight;
  const decayRate = customDecay !== null ? customDecay : optimalDecay;
  return solveDixonColesMLE(matches, teamIds, targetDateStr, 30, eloMap, xGBlendWeight, decayRate, league);
}
