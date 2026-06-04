import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { blendWithBookmaker } from '../scrapers/oddsApi.js';
import { getMostLikelyScoreConsistent, calcOverUnder } from '../models/poisson.js';

// Iterative Proportional Fitting (IPF) for matrix calibration
function calibrateMatrixIPF(matrix, target1X2, targetOU, iterations = 10) {
  let scoreMatrix = JSON.parse(JSON.stringify(matrix));
  const size = scoreMatrix.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Constraint 1: 1X2 partitions
    let currentHome = 0, currentDraw = 0, currentAway = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i > j) currentHome += scoreMatrix[i][j];
        else if (i === j) currentDraw += scoreMatrix[i][j];
        else currentAway += scoreMatrix[i][j];
      }
    }

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i > j && currentHome > 0) scoreMatrix[i][j] *= (target1X2.home / currentHome);
        else if (i === j && currentDraw > 0) scoreMatrix[i][j] *= (target1X2.draw / currentDraw);
        else if (i < j && currentAway > 0) scoreMatrix[i][j] *= (target1X2.away / currentAway);
      }
    }

    // Constraint 2: Over/Under 2.5
    let currentUnder = 0, currentOver = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i + j <= 2.5) currentUnder += scoreMatrix[i][j];
        else currentOver += scoreMatrix[i][j];
      }
    }

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i + j <= 2.5 && currentUnder > 0) scoreMatrix[i][j] *= (targetOU.under25 / currentUnder);
        else if (i + j > 2.5 && currentOver > 0) scoreMatrix[i][j] *= (targetOU.over25 / currentOver);
      }
    }

    // Re-normalize
    let totalSum = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) totalSum += scoreMatrix[i][j];
    }
    if (totalSum > 0) {
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) scoreMatrix[i][j] /= totalSum;
      }
    }
  }

  return scoreMatrix;
}

async function runTest() {
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

  let okWithoutIPF = 0;
  let okWithIPF = 0;

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

    const pred = predict({
      homeStats,
      awayStats,
      homeRecentMatches,
      awayRecentMatches,
      homeHomeRecentMatches,
      awayAwayRecentMatches,
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeElo: m.home_elo || 1500,
      awayElo: m.away_elo || 1500,
      leagueAvgHome,
      leagueAvgAway,
      situationalFactors: {},
      h2hAvgGoals: 0,
      h2hRecentResults,
      homeRestDays: 4,
      awayRestDays: 4,
      homeWinRate: 0.5,
      matchDate,
      isNeutral: false,
    });

    const blend = await blendWithBookmaker(pred.result, pred.overUnder, m.id, db, pred.confidence, true);
    pred.result = blend.result;
    pred.overUnder = blend.overUnder;

    const actGF = m.score_home;
    const actGA = m.score_away;

    // Without Over/Under IPF (Standard predict result)
    if (actGF === pred.score.home && actGA === pred.score.away) {
      okWithoutIPF++;
    }

    // With Over/Under IPF Calibration
    const target1X2 = pred.result;
    const targetOU = {
      over25: pred.overUnder.over25,
      under25: pred.overUnder.under25
    };

    const calibratedMatrix = calibrateMatrixIPF(pred.scoreMatrix, target1X2, targetOU);
    const predScoreIPF = getMostLikelyScoreConsistent(calibratedMatrix, target1X2);

    if (actGF === predScoreIPF.home && actGA === predScoreIPF.away) {
      okWithIPF++;
    }
  }

  console.log(`Results using official predictor:`);
  console.log(`Without Over/Under IPF Calibration: ${okWithoutIPF}/50 (${(okWithoutIPF/50*100).toFixed(1)}%)`);
  console.log(`With Over/Under IPF Calibration:    ${okWithIPF}/50 (${(okWithIPF/50*100).toFixed(1)}%)`);
}

runTest();
