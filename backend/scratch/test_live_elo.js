import { getDatabase, queryGet, queryAll } from '../db/database.js';
import { processMatchEloUpdate, getTeamElo } from '../models/elo.js';

async function test() {
  console.log('--- STARTING LIVE ELO UPDATE TEST ---');
  const db = await getDatabase();

  // Pick a sample match to simulate update
  const match = await queryGet(db, 
    `SELECT m.*, ht.name as home_name, at.name as away_name 
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     WHERE m.status = 'SCHEDULED' 
     LIMIT 1`
  ) || await queryGet(db,
    `SELECT m.*, ht.name as home_name, at.name as away_name
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     LIMIT 1`
  );

  if (!match) {
    console.log('No matches found in database to test with.');
    process.exit(1);
  }

  console.log(`Testing with Match: ${match.home_name} vs ${match.away_name} (ID: ${match.id})`);

  // Clear existing history for this match to ensure clean run
  await new Promise((resolve) => {
    db.run('DELETE FROM elo_history WHERE match_id = ?', [match.id], () => resolve());
  });

  const eloHomeBefore = await getTeamElo(db, match.home_team_id);
  const eloAwayBefore = await getTeamElo(db, match.away_team_id);

  console.log(`Elo Before: Home=${eloHomeBefore}, Away=${eloAwayBefore}`);

  // Simulate home team winning 2-1
  const simulatedMatch = {
    ...match,
    score_home: 2,
    score_away: 1,
    date: match.date || '2026-06-08'
  };

  await processMatchEloUpdate(db, simulatedMatch);

  const eloHomeAfter = await getTeamElo(db, match.home_team_id);
  const eloAwayAfter = await getTeamElo(db, match.away_team_id);

  console.log(`Elo After: Home=${eloHomeAfter}, Away=${eloAwayAfter}`);

  // Fetch from elo_history to verify log integrity
  const history = await queryAll(db, 'SELECT * FROM elo_history WHERE match_id = ?', [match.id]);
  console.log('Elo History Logged Records:', history);

  if (history.length === 2 && eloHomeAfter > eloHomeBefore && eloAwayAfter < eloAwayBefore) {
    console.log('✅ TEST PASSED: ELO successfully updated and logged!');
  } else {
    console.log('❌ TEST FAILED: Verification checks not met.');
  }

  process.exit(0);
}

test().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});
