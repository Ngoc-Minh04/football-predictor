import express from 'express';
import { getDatabase, queryGet, queryRun, queryAll } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { analyzeMatch } from '../ai/claudeAnalyzer.js';
import { updateProbabilities } from '../utils/bayesianUpdate.js';
import { broadcastProbabilityUpdate } from '../index.js';
import { validateMatch } from '../middleware/validateMatch.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';

const router = express.Router();

/**
 * POST /api/predict/prematch
 * Body: { homeTeamId, awayTeamId, league, matchDate, situationalFactors?, injuries?, homeForm?, awayForm? }
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

    // Get league average goals (home and away) for current season
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const season = currentMonth >= 7 ? currentYear : currentYear - 1;

    const leagueAvgHomeRow = await queryGet(db,
      `SELECT AVG(CAST(score_home AS REAL)) as avg
       FROM matches
       WHERE league = ? AND status = 'FINISHED' AND season = ?`,
      [league, season]
    );
    const leagueAvgAwayRow = await queryGet(db,
      `SELECT AVG(CAST(score_away AS REAL)) as avg
       FROM matches
       WHERE league = ? AND status = 'FINISHED' AND season = ?`,
      [league, season]
    );
    const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
    const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

    // Fetch H2H matches to calculate average goals in last 5 matches
    const h2hMatches = await queryAll(db,
      `SELECT score_home, score_away FROM matches
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
      // Upgrade 3: pass raw H2H results for win/draw/loss dominance check
      h2hRecentResults = h2hMatches.map(m => ({ homeGoals: m.score_home, awayGoals: m.score_away }));
    }

    // Fetch 8 recent finished matches for home and away teams (mixed venue)
    const homeRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE (home_team_id = ? OR away_team_id = ?)
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 8`,
      [homeTeamId, homeTeamId]
    );

    const awayRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE (home_team_id = ? OR away_team_id = ?)
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 8`,
      [awayTeamId, awayTeamId]
    );

    // Upgrade 1: venue-specific — home team's home-only matches
    const homeHomeRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE home_team_id = ?
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 6`,
      [homeTeamId]
    );

    // Upgrade 1: venue-specific — away team's away-only matches
    const awayAwayRecentMatches = await queryAll(db,
      `SELECT * FROM matches
       WHERE away_team_id = ?
         AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       ORDER BY date DESC LIMIT 6`,
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
    });

    // Upgrade 4: Flexible odds blending based on model confidence
    // High confidence (>= 0.65) → trust model more (70/30)
    // Low confidence  (<  0.45) → trust bookmaker more (35/65)
    // Mid confidence             → 55/45 (default)
    if (matchId) {
      const blend = await blendWithBookmaker(prediction.result, prediction.overUnder, matchId, db, prediction.confidence);
      prediction.result = blend.result;
      prediction.overUnder = blend.overUnder;
      if (blend.blended) {
        prediction.factors = prediction.factors || [];
        prediction.factors.push({ factor: `Tích hợp tỷ lệ nhà cái (Odds API, trọng số model ${Math.round(blend.modelWeight * 100)}%)`, impact: Math.round((1 - blend.modelWeight) * 100) / 100, icon: '📈' });
      }
    }

    // Get Claude AI analysis
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
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
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
