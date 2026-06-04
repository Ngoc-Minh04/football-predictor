import express from 'express';
import { getDatabase, queryGet, queryRun, queryAll } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { analyzeMatch, analyzeInjuriesAndContextWithAI, analyzeLineupsWithAI } from '../ai/claudeAnalyzer.js';
import { updateProbabilities } from '../utils/bayesianUpdate.js';
import { broadcastProbabilityUpdate } from '../index.js';
import { validateMatch } from '../middleware/validateMatch.js';
import { blendWithBookmaker, fetchAndStoreOdds } from '../scrapers/oddsApi.js';
import { toViName } from '../utils/teamTranslator.js';
import { parseInjuries } from '../utils/parseInjuries.js';
import { getDixonColesStrengths } from '../utils/dixonColesSolver.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';

const router = express.Router();

// Upgrade 5: In-memory rate limit — fetch odds at most once per hour per league
const oddsFetchedAt = {}; // { league: Date }
async function autoFetchOddsIfStale(league, matchId, db) {
  const now = Date.now();
  const lastFetch = oddsFetchedAt[league] || 0;
  const ONE_HOUR = 60 * 60 * 1000;

  // Skip if fetched recently
  if (now - lastFetch < ONE_HOUR) return;

  // Check if odds exist and are fresh for this specific match
  if (matchId) {
    const existing = await queryGet(db,
      `SELECT 1 FROM odds_cache WHERE match_id = ? AND datetime(fetched_at, '+6 hours') >= datetime('now')`,
      [matchId]
    );
    if (existing) return; // Already fresh — no need to re-fetch
  }

  // Fetch odds in background (non-blocking) — results available on next request
  oddsFetchedAt[league] = now;
  fetchAndStoreOdds(league).then(() => {
    console.log(`[predict] Auto-fetch odds done for league=${league}`);
  }).catch(e => {
    console.warn(`[predict] Auto-fetch odds failed: ${e.message}`);
    delete oddsFetchedAt[league]; // allow retry
  });
}

function parseCustomOdds(customOdds) {
  if (!customOdds) return null;
  const { homeOdd, drawOdd, awayOdd, over25Odd, under25Odd } = customOdds;

  let resultProb = null;
  let ouProb = null;

  // 1X2 Odds
  const h = parseFloat(homeOdd);
  const d = parseFloat(drawOdd);
  const a = parseFloat(awayOdd);
  if (!isNaN(h) && !isNaN(d) && !isNaN(a) && h > 1 && d > 1 && a > 1) {
    const sumInv = (1 / h) + (1 / d) + (1 / a);
    resultProb = {
      home_prob: (1 / h) / sumInv,
      draw_prob: (1 / d) / sumInv,
      away_prob: (1 / a) / sumInv,
    };
  }

  // Over/Under Odds
  const ov = parseFloat(over25Odd);
  const un = parseFloat(under25Odd);
  if (!isNaN(ov) && !isNaN(un) && ov > 1 && un > 1) {
    const sumInvOU = (1 / ov) + (1 / un);
    ouProb = {
      over25_prob: (1 / ov) / sumInvOU,
      under25_prob: (1 / un) / sumInvOU,
    };
  }

  if (resultProb || ouProb) {
    return { resultProb, ouProb };
  }
  return null;
}

/**
 * POST /api/predict/prematch
 * Body: { homeTeamId, awayTeamId, league, matchDate, situationalFactors?, injuries?, homeForm?, awayForm?, customOdds? }
 */
router.post('/prematch', validateMatch, async (req, res) => {
  try {
    const db = await getDatabase();
    const {
      homeTeamId,
      awayTeamId,
      league = 'PL',
      matchDate,
      situationalFactors = {},
      injuries = '',
      homeForm = '',
      awayForm = '',
      h2h = '',
      isNeutral = false,          // Upgrade 2: World Cup / neutral venue
      isKnockout = false,
      weather = 'fine',
      referee = 'normal',
      customOdds = null,
      customHandicap = null,
      homeLineup = '',
      awayLineup = '',
    } = req.body;

    if (!homeTeamId || !awayTeamId) {
      return res.status(400).json({ error: 'homeTeamId and awayTeamId are required' });
    }

    // Fetch team info
    const homeTeam = await queryGet(db, 'SELECT * FROM teams WHERE id = ?', [homeTeamId]);
    const awayTeam = await queryGet(db, 'SELECT * FROM teams WHERE id = ?', [awayTeamId]);

    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: 'One or both teams not found' });
    }

    // Fetch stats for current season
    const homeStats = await queryGet(db,
      'SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1',
      [homeTeamId]
    ) || { goals_scored: 0, goals_conceded: 0, matches_played: 0, xG: 0, xGA: 0 };

    const awayStats = await queryGet(db,
      'SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1',
      [awayTeamId]
    ) || { goals_scored: 0, goals_conceded: 0, matches_played: 0, xG: 0, xGA: 0 };

    // Get league average goals (home and away) for current season, fallback to history if games < 10
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const season = currentMonth >= 7 ? currentYear : currentYear - 1;

    const finishedCountRow = await queryGet(db,
      `SELECT COUNT(*) as count FROM matches WHERE league = ? AND status = 'FINISHED' AND season = ?`,
      [league, season]
    );
    const finishedCount = finishedCountRow?.count || 0;

    let leagueAvgHomeRow, leagueAvgAwayRow;
    if (finishedCount >= 10) {
      leagueAvgHomeRow = await queryGet(db,
        `SELECT AVG(CAST(score_home AS REAL)) as avg
         FROM matches
         WHERE league = ? AND status = 'FINISHED' AND season = ?`,
        [league, season]
      );
      leagueAvgAwayRow = await queryGet(db,
        `SELECT AVG(CAST(score_away AS REAL)) as avg
         FROM matches
         WHERE league = ? AND status = 'FINISHED' AND season = ?`,
        [league, season]
      );
    } else {
      console.log(`[predict.js] Dữ liệu mùa ${season} quá ít (${finishedCount} trận), lấy trung bình lịch sử giải đấu ${league}...`);
      leagueAvgHomeRow = await queryGet(db,
        `SELECT AVG(CAST(score_home AS REAL)) as avg
         FROM matches
         WHERE league = ? AND status = 'FINISHED'`,
        [league]
      );
      leagueAvgAwayRow = await queryGet(db,
        `SELECT AVG(CAST(score_away AS REAL)) as avg
         FROM matches
         WHERE league = ? AND status = 'FINISHED'`,
         [league]
      );
    }

    const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
    const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

    // Fetch H2H matches to calculate average goals in last 5 matches
    const h2hMatches = await queryAll(db,
      `SELECT score_home, score_away, home_team_id, away_team_id FROM matches
       WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 5`,
      [homeTeamId, awayTeamId, awayTeamId, homeTeamId]
    );

    let h2hAvgGoals = 0;
    let h2hRecentResults = [];
    if (h2hMatches.length > 0) {
      const totalGoals = h2hMatches.reduce((sum, m) => sum + m.score_home + m.score_away, 0);
      h2hAvgGoals = totalGoals / h2hMatches.length;
      
      const currentHomeIdNum = Number(homeTeamId);
      h2hRecentResults = h2hMatches.map(m => {
        const isCurrentHomeTeamHome = Number(m.home_team_id) === currentHomeIdNum;
        return {
          homeGoals: isCurrentHomeTeamHome ? m.score_home : m.score_away,
          awayGoals: isCurrentHomeTeamHome ? m.score_away : m.score_home
        };
      });
    }

    // Fetch 12 recent finished matches for home and away teams (mixed venue)
    const homeRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE (m.home_team_id = ? OR m.away_team_id = ?)
         AND m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       ORDER BY m.date DESC LIMIT 12`,
      [homeTeamId, homeTeamId]
    );

    const awayRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE (m.home_team_id = ? OR m.away_team_id = ?)
         AND m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       ORDER BY m.date DESC LIMIT 12`,
      [awayTeamId, awayTeamId]
    );

    // Upgrade 1: venue-specific — home team's home-only matches
    const homeHomeRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.home_team_id = ?
         AND m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       ORDER BY m.date DESC LIMIT 6`,
      [homeTeamId]
    );

    // Upgrade 1: venue-specific — away team's away-only matches
    const awayAwayRecentMatches = await queryAll(db,
      `SELECT m.*, ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.away_team_id = ?
         AND m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       ORDER BY m.date DESC LIMIT 6`,
      [awayTeamId]
    );

    const targetDate = matchDate || new Date().toISOString().split('T')[0];
    function calcRestDays(target, last) {
      if (!last || !target) return 4;
      const diff = Math.round((new Date(target) - new Date(last)) / (1000 * 60 * 60 * 24));
      return diff >= 0 ? diff : 4;
    }
    const homeRestDays = calcRestDays(targetDate, homeRecentMatches[0]?.date);
    const awayRestDays = calcRestDays(targetDate, awayRecentMatches[0]?.date);

    // Fetch last 10 finished home matches for home team
    const homeHomeMatches = await queryAll(db,
      `SELECT score_home, score_away FROM matches
       WHERE home_team_id = ? AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 10`,
      [homeTeamId]
    );

    let homeWinRate = 0.5; // default fallback
    if (homeHomeMatches.length > 0) {
      const wins = homeHomeMatches.filter(m => m.score_home > m.score_away).length;
      homeWinRate = wins / homeHomeMatches.length;
    }

    // Find match ID
    let matchId = null;
    if (matchDate) {
      const matchRow = await queryGet(db,
        'SELECT id FROM matches WHERE home_team_id = ? AND away_team_id = ? AND date = ?',
        [homeTeamId, awayTeamId, matchDate]
      );
      if (matchRow) matchId = matchRow.id;
    }

    // Upgrade 5: Auto-fetch odds if stale (rate-limited: once/hour per league)
    autoFetchOddsIfStale(league, matchId, db);

    // Parse injuries text into lambda penalty & AI Context analysis (Hướng 2)
    let injuryFactor = { homeAttackPenalty: 0.0, awayAttackPenalty: 0.0, homeDefensePenalty: 0.0, awayDefensePenalty: 0.0, homeMotivation: 1.0, awayMotivation: 1.0, reasoning: '' };
    const cleanedInjuries = injuries ? injuries.trim() : '';

    if (cleanedInjuries.length > 5) {
      console.log(`[predict] Kích hoạt AI-Powered News Analyzer cho tin tức: "${cleanedInjuries}"`);
      try {
        const aiQuant = await analyzeInjuriesAndContextWithAI(cleanedInjuries, homeTeam.name, awayTeam.name);
        injuryFactor = aiQuant;
        console.log(`[predict] AI Context Results:`, aiQuant);
      } catch (aiErr) {
        console.warn(`[predict] AI Context analysis failed, falling back to regex: ${aiErr.message}`);
        const regexInj = parseInjuries(cleanedInjuries, homeTeam.name, awayTeam.name);
        injuryFactor.homeAttackPenalty = regexInj.homeReduction;
        injuryFactor.awayAttackPenalty = regexInj.awayReduction;
      }
    } else if (cleanedInjuries.length > 0) {
      // Dùng regex thô sơ nếu tin quá ngắn
      const regexInj = parseInjuries(cleanedInjuries, homeTeam.name, awayTeam.name);
      injuryFactor.homeAttackPenalty = regexInj.homeReduction;
      injuryFactor.awayAttackPenalty = regexInj.awayReduction;
    }

    // Parse lineups using AI Lineup Analyzer (Nâng Cấp Mới)
    let lineupFactor = { homeAttackPenalty: 0.0, awayAttackPenalty: 0.0, homeDefensePenalty: 0.0, awayDefensePenalty: 0.0, homeMotivation: 1.0, awayMotivation: 1.0, tacticsReasoning: '' };
    const cleanHomeLineup = homeLineup ? homeLineup.trim() : '';
    const cleanAwayLineup = awayLineup ? awayLineup.trim() : '';

    if (cleanHomeLineup.length > 5 || cleanAwayLineup.length > 5) {
      console.log(`[predict] Kích hoạt AI Lineup Analyzer cho đội hình ra sân...`);
      try {
        const aiLineup = await analyzeLineupsWithAI(cleanHomeLineup, cleanAwayLineup, homeTeam.name, awayTeam.name);
        lineupFactor = aiLineup;
        console.log(`[predict] AI Lineup Results:`, aiLineup);
      } catch (lineupErr) {
        console.warn(`[predict] AI Lineup analysis failed: ${lineupErr.message}`);
      }
    }

    // Gộp chỉ số chấn thương và đội hình ra sân
    const finalHomeAttackPenalty = Math.max(injuryFactor.homeAttackPenalty, lineupFactor.homeAttackPenalty);
    const finalAwayAttackPenalty = Math.max(injuryFactor.awayAttackPenalty, lineupFactor.awayAttackPenalty);
    const finalHomeDefensePenalty = Math.max(injuryFactor.homeDefensePenalty, lineupFactor.homeDefensePenalty);
    const finalAwayDefensePenalty = Math.max(injuryFactor.awayDefensePenalty, lineupFactor.awayDefensePenalty);
    const finalHomeMotivation = injuryFactor.homeMotivation * lineupFactor.homeMotivation;
    const finalAwayMotivation = injuryFactor.awayMotivation * lineupFactor.awayMotivation;

    const mergedReasoningParts = [];
    if (injuryFactor.reasoning && injuryFactor.reasoning !== 'Không có phân tích ngữ cảnh (dùng giá trị mặc định)') {
      mergedReasoningParts.push(`[Chấn thương]: ${injuryFactor.reasoning}`);
    }
    if (lineupFactor.tacticsReasoning && lineupFactor.tacticsReasoning !== 'Không có phân tích đội hình ra sân (dùng mặc định)' && lineupFactor.tacticsReasoning !== '') {
      mergedReasoningParts.push(`[Chiến thuật Đội hình]: ${lineupFactor.tacticsReasoning}`);
    }
    const mergedReasoning = mergedReasoningParts.join(' | ') || 'Không có phân tích bổ sung';

    const mergedInjuryFactor = {
      homeAttackPenalty: finalHomeAttackPenalty,
      awayAttackPenalty: finalAwayAttackPenalty,
      homeDefensePenalty: finalHomeDefensePenalty,
      awayDefensePenalty: finalAwayDefensePenalty,
      homeMotivation: finalHomeMotivation,
      awayMotivation: finalAwayMotivation,
      reasoning: mergedReasoning
    };

    // Calculate Dixon-Coles strengths dynamically
    let dixonColesStrengths = null;
    try {
      dixonColesStrengths = await getDixonColesStrengths(league, season, targetDate);
    } catch (dcErr) {
      console.warn(`[predict] Failed to calculate Dixon-Coles strengths: ${dcErr.message}`);
    }

    // Run statistical prediction using Rolling Form Window
    const prediction = predict({
      homeStats,
      awayStats,
      homeRecentMatches,
      awayRecentMatches,
      homeHomeRecentMatches,   // Upgrade 1
      awayAwayRecentMatches,   // Upgrade 1
      homeTeamId,
      awayTeamId,
      homeElo: homeTeam.elo_rating || 1500,
      awayElo: awayTeam.elo_rating || 1500,
      leagueAvgHome,
      leagueAvgAway,
      situationalFactors,
      h2hAvgGoals,
      h2hRecentResults,        // Upgrade 3
      homeRestDays,
      awayRestDays,
      homeWinRate,
      matchDate: targetDate,
      isNeutral,               // Upgrade 2
      isKnockout,
      injuryFactor: mergedInjuryFactor, // Gộp cả lineup và chấn thương
      dixonColesStrengths,
      weather,
      referee,
      targetLeague: league,    // Hướng C: Dynamic Decay
      homeTeamName: homeTeam.name,
      awayTeamName: awayTeam.name,
    });

    // Upgrade 4: Flexible odds blending based on model confidence
    // High confidence (>= 0.65) → trust model more (70/30)
    // Low confidence  (<  0.45) → trust bookmaker more (35/65)
    // Mid confidence             → 55/45 (default)
    let modelWeight = 0.55;
    if (prediction.confidence >= 0.65) {
      modelWeight = 0.70;
    } else if (prediction.confidence < 0.45) {
      modelWeight = 0.35;
    }
    const bookWeight = 1 - modelWeight;

    let activeCorrectScoreOdds = null;
    const parsedOdds = parseCustomOdds(customOdds);
    if (parsedOdds) {
      const { resultProb, ouProb } = parsedOdds;
      let blended = false;
      if (resultProb) {
        prediction.result = {
          home: modelWeight * prediction.result.home + bookWeight * resultProb.home_prob,
          draw: modelWeight * prediction.result.draw + bookWeight * resultProb.draw_prob,
          away: modelWeight * prediction.result.away + bookWeight * resultProb.away_prob,
        };
        blended = true;
      }
      if (ouProb) {
        prediction.overUnder = {
          over25: modelWeight * prediction.overUnder.over25 + bookWeight * ouProb.over25_prob,
          under25: modelWeight * prediction.overUnder.under25 + bookWeight * ouProb.under25_prob,
          prediction: (modelWeight * prediction.overUnder.over25 + bookWeight * ouProb.over25_prob) > 0.5 ? 'Tài' : 'Xỉu',
        };
        blended = true;
      }
      if (blended) {
        prediction.factors = prediction.factors || [];
        prediction.factors.push({
          factor: `Tích hợp tỷ lệ nhà cái tự chọn (trọng số model ${Math.round(modelWeight * 100)}%)`,
          impact: Math.round(bookWeight * 100) / 100,
          icon: '📈',
        });
      }
    } else if (matchId) {
      const blend = await blendWithBookmaker(prediction.result, prediction.overUnder, matchId, db, prediction.confidence);
      prediction.result = blend.result;
      prediction.overUnder = blend.overUnder;
      if (blend.blended) {
        prediction.factors = prediction.factors || [];
        prediction.factors.push({ factor: `Tích hợp tỷ lệ nhà cái (Odds API, trọng số model ${Math.round(blend.modelWeight * 100)}%)`, impact: Math.round((1 - blend.modelWeight) * 100) / 100, icon: '📈' });
        
        // Nhận diện kèo chấp châu Á tự động cào từ nhà cái
        if (blend.handicap) {
          prediction.autoHandicapInfo = blend.handicap;
        }

        // Nhận diện Correct Score odds để tính EV
        if (blend.correctScoreOdds) {
          activeCorrectScoreOdds = blend.correctScoreOdds;
        }
      }
    }

    // Parse custom Asian Handicap if provided
    let targetHandicap = null;
    if (customHandicap) {
      const hVal = parseFloat(customHandicap.handicap);
      const hHome = parseFloat(customHandicap.homeOdd);
      const hAway = parseFloat(customHandicap.awayOdd);
      if (!isNaN(hVal) && !isNaN(hHome) && !isNaN(hAway) && hHome > 1 && hAway > 1) {
        const sumInv = (1 / hHome) + (1 / hAway);
        targetHandicap = {
          handicap: hVal,
          upperProb: (1 / hHome) / sumInv,
          lowerProb: (1 / hAway) / sumInv,
        };
        prediction.factors = prediction.factors || [];
        prediction.factors.push({
          factor: `Tích hợp Kèo chấp Châu Á: Đội nhà ${hVal > 0 ? '+' : ''}${hVal} (Xác suất sạch: ${Math.round(targetHandicap.upperProb * 100)}% / ${Math.round(targetHandicap.lowerProb * 100)}%)`,
          impact: 1.0,
          icon: '🎯',
        });
      }
    } else if (prediction.autoHandicapInfo) {
      // Dùng handicap tự động từ nhà cái
      targetHandicap = prediction.autoHandicapInfo;
      const hVal = targetHandicap.handicap;
      prediction.factors = prediction.factors || [];
      prediction.factors.push({
        factor: `Tích hợp Kèo chấp Châu Á tự động: Đội nhà ${hVal > 0 ? '+' : ''}${hVal} (Xác suất sạch: ${Math.round(targetHandicap.upperProb * 100)}% / ${Math.round(targetHandicap.lowerProb * 100)}%)`,
        impact: 1.0,
        icon: '🎯',
      });
    }

    // Calibrate score matrix using Iterative Proportional Fitting (IPF)
    const calibratedMatrix = calibrateMatrixIPF(prediction.scoreMatrix, prediction.result, prediction.overUnder, targetHandicap);
    prediction.scoreMatrix = calibratedMatrix;
    prediction.score = getMostLikelyScoreConsistent(calibratedMatrix, prediction.result);

    // Tính toán Value Bets dựa trên Expected Value (+EV) (Hướng B)
    const valueBets = [];
    if (activeCorrectScoreOdds) {
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
              if (ev > 0) {
                valueBets.push({
                  score: { home: hG, away: aG },
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
    prediction.valueBets = valueBets.slice(0, 3);

    // Get Gemini AI analysis (có cache 24h — không tốn request lặp với cùng cặp đội)
    const aiAnalysis = await analyzeMatch({
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      league,
      homeForm,
      awayForm,
      h2h,
      injuries,
      situationalFactors,
      prediction,
      matchDate: targetDate,   // dùng cho cache key
    });

    if (matchId) {
      await queryRun(db,
        `INSERT INTO predictions (match_id, predicted_score, result_probs, confidence, ai_analysis)
         VALUES (?, ?, ?, ?, ?)`,
        [
          matchId,
          JSON.stringify(prediction.score),
          JSON.stringify(prediction.result),
          prediction.confidence,
          aiAnalysis.summary || '',
        ]
      );
    }

    console.log(`[API/predict] ${homeTeam.name} vs ${awayTeam.name} — confidence: ${prediction.confidence}`);

    res.json({
      homeTeam: toViName(homeTeam.name),
      awayTeam: toViName(awayTeam.name),
      score: prediction.score,
      result: prediction.result,
      overUnder: prediction.overUnder,
      confidence: prediction.confidence,
      factors: [...(prediction.factors || []), ...(aiAnalysis.keyFactors || [])],
      lambdas: prediction.lambdas,
      scoreMatrix: prediction.scoreMatrix,
      goals_last5: prediction.goals_last5,
      clean_sheet_rate: prediction.clean_sheet_rate,
      h2h_avg_goals: prediction.h2h_avg_goals,
      rest_days: prediction.rest_days,
      aiAnalysis: {
        summary: aiAnalysis.summary || '',
        riskLevel: aiAnalysis.riskLevel || 'medium',
        recommendation: aiAnalysis.recommendation || '',
      },
      aiContext: {
        reasoning: mergedInjuryFactor.reasoning || '',
        homeAttackPenalty: mergedInjuryFactor.homeAttackPenalty || 0,
        awayAttackPenalty: mergedInjuryFactor.awayAttackPenalty || 0,
        homeDefensePenalty: mergedInjuryFactor.homeDefensePenalty || 0,
        awayDefensePenalty: mergedInjuryFactor.awayDefensePenalty || 0,
        homeMotivation: mergedInjuryFactor.homeMotivation || 1.0,
        awayMotivation: mergedInjuryFactor.awayMotivation || 1.0
      },
      aiLineupAnalysis: lineupFactor.tacticsReasoning || '',
      valueBets: prediction.valueBets || [],
    });
  } catch (err) {
    console.error('[API/predict/prematch] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/predict/live
 * Body: { matchId, priorProbs: { home, draw, away }, minute, score: { home, away }, events: [] }
 */
router.post('/live', async (req, res) => {
  try {
    const { matchId, priorProbs, minute, score, events = [] } = req.body;

    if (!priorProbs || !minute === undefined || !score) {
      return res.status(400).json({ error: 'priorProbs, minute, and score are required' });
    }

    const updatedProbs = updateProbabilities(priorProbs, { minute, score, events });

    const momentumShift = {
      home: updatedProbs.home - priorProbs.home,
      away: updatedProbs.away - priorProbs.away,
    };

    const result = {
      updatedProbabilities: updatedProbs,
      momentumShift,
      minute,
      score,
    };

    // Broadcast to WebSocket subscribers if matchId given
    if (matchId) {
      broadcastProbabilityUpdate(matchId, result);
    }

    res.json(result);
  } catch (err) {
    console.error('[API/predict/live] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
