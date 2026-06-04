import { getDatabase, queryAll } from '../db/database.js';

async function checkAllOdds() {
  const db = await getDatabase();
  const rows = await queryAll(db,
    `SELECT COUNT(DISTINCT m.id) as count 
     FROM matches m
     JOIN odds_cache o ON m.id = o.match_id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL`
  );
  console.log('Total finished matches with cached odds:', rows[0].count);
  
  const sample = await queryAll(db,
    `SELECT m.id, m.date, m.home_team_id, m.away_team_id, m.score_home, m.score_away,
            ht.name as home_name, at.name as away_name
     FROM matches m
     JOIN odds_cache o ON m.id = o.match_id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at ON m.away_team_id = at.id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
     ORDER BY m.date DESC LIMIT 20`
  );
  console.log('Sample matches with odds:', sample);
}

checkAllOdds();
