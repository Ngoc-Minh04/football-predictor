import fs from 'fs';
import path from 'path';
import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { getDixonColesStrengths } from '../utils/dixonColesSolver.js';
import { calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';

async function runTuning() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║        Auto-Tuner — Copula & ELO Parameter Optimization║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  try {
    const db = await getDatabase();
    
    // Load historical matches for tuning
    const matches = await queryAll(db,
      `SELECT m.*, ht.name as home_name, at.name as away_name,
              ht.elo_rating as home_elo, at.elo_rating as away_elo
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       ORDER BY m.date DESC LIMIT 40`
    );

    if (matches.length === 0) {
      console.log('No finished matches found to tune parameters.');
      process.exit(1);
    }

    console.log(`Tuning across ${matches.length} matches...`);

    // Define search space
    const decayGrid = [0.0035, 0.0045, 0.0055];
    const eloWeightGrid = [0.10, 0.15, 0.25];
    const bivariateWeightGrid = [0.60, 0.70, 0.80];

    let bestAccuracy = -1;
    let bestParams = {};

    // Nested loops for Grid Search
    for (const testDecay of decayGrid) {
      for (const testElo of eloWeightGrid) {
        for (const testBiv of bivariateWeightGrid) {
          let correctScore = 0;

          for (const m of matches) {
            const matchDate = m.date;
            const homeId = m.home_team_id;
            const awayId = m.away_team_id;

            // Fetch League Avgs
            const leagueAvgHomeRow = await queryGet(db,
              `SELECT AVG(CAST(score_home AS REAL)) as avg FROM matches WHERE league = ? AND status = 'FINISHED' AND date < ?`,
              [m.league, matchDate]
            );
            const leagueAvgAwayRow = await queryGet(db,
              `SELECT AVG(CAST(score_away AS REAL)) as avg FROM matches WHERE league = ? AND status = 'FINISHED' AND date < ?`,
              [m.league, matchDate]
            );
            const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
            const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

            // H2H
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

            const homeRecentMatches = await queryAll(db,
              `SELECT * FROM matches WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'FINISHED' AND date < ? ORDER BY date DESC LIMIT 12`,
              [homeId, homeId, matchDate]
            );
            const awayRecentMatches = await queryAll(db,
              `SELECT * FROM matches WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'FINISHED' AND date < ? ORDER BY date DESC LIMIT 12`,
              [awayId, awayId, matchDate]
            );

            const homeStats = await queryGet(db, 'SELECT * FROM team_stats WHERE team_id = ? AND season = ?', [homeId, m.season]) || { goals_scored: 20, goals_conceded: 15, matches_played: 14 };
            const awayStats = await queryGet(db, 'SELECT * FROM team_stats WHERE team_id = ? AND season = ?', [awayId, m.season]) || { goals_scored: 15, goals_conceded: 20, matches_played: 14 };

            let dixonColesStrengths = null;
            try {
              dixonColesStrengths = await getDixonColesStrengths(m.league, m.season, matchDate);
            } catch (err) {}

            const pred = predict({
              homeStats,
              awayStats,
              homeRecentMatches,
              awayRecentMatches,
              homeTeamId: homeId,
              awayTeamId: awayId,
              homeElo: m.home_elo || 1500,
              awayElo: m.away_elo || 1500,
              leagueAvgHome,
              leagueAvgAway,
              h2hAvgGoals,
              dixonColesStrengths,
              decay: testDecay,
              eloWeight: testElo,
              bivariateWeight: testBiv
            });

            const calibratedMatrix = calibrateMatrixIPF(pred.scoreMatrix, pred.result, pred.overUnder);
            const score = getMostLikelyScoreConsistent(calibratedMatrix, pred.result);

            if (m.score_home === score.home && m.score_away === score.away) {
              correctScore++;
            }
          }

          const acc = correctScore / matches.length;
          console.log(`Tested: decay=${testDecay}, eloWeight=${testElo}, bivariateWeight=${testBiv} ➔ Correct Score: ${(acc * 100).toFixed(1)}%`);

          if (acc > bestAccuracy) {
            bestAccuracy = acc;
            bestParams = {
              decay: testDecay,
              eloWeight: testElo,
              bivariateWeight: testBiv
            };
          }
        }
      }
    }

    console.log('\n🌟 OPTIMIZATION COMPLETE 🌟');
    console.log(`Best Correct Score Accuracy: ${(bestAccuracy * 100).toFixed(1)}%`);
    console.log('Best Parameters:', bestParams);

    // Save configuration
    const configPath = path.resolve(process.cwd(), 'config/optimal_params.json');
    const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const updated = { ...existing, ...bestParams };
    
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    console.log(`Saved optimal parameters to: ${configPath}`);

  } catch (err) {
    console.error('Tuning error:', err.message);
  }
  process.exit(0);
}

runTuning();
