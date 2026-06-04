import { getDatabase, queryAll } from '../db/database.js';

async function checkOdds() {
  const db = await getDatabase();
  const totalMatches = await queryAll(db,
    `SELECT COUNT(*) as count FROM matches 
     WHERE status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       AND date BETWEEN '2024-11-01' AND '2025-02-28'`
  );
  
  const matchesWithOdds = await queryAll(db,
    `SELECT COUNT(DISTINCT m.id) as count 
     FROM matches m
     JOIN odds_cache o ON m.id = o.match_id
     WHERE m.status = 'FINISHED' AND m.score_home IS NOT NULL AND m.score_away IS NOT NULL
       AND m.date BETWEEN '2024-11-01' AND '2025-02-28'`
  );

  console.log('Total matches in backtest window:', totalMatches[0].count);
  console.log('Matches with cached odds:', matchesWithOdds[0].count);
}

checkOdds();
