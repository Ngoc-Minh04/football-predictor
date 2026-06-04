import { getDatabase, queryAll } from '../db/database.js';

async function main() {
  const db = await getDatabase();
  const wcTeams = await queryAll(db, "SELECT id, name, elo_rating FROM teams WHERE league LIKE '%WC%'");
  console.log(`\n📊 Số lượng đội tuyển giải WC trong DB: ${wcTeams.length}`);
  if (wcTeams.length > 0) {
    console.log('Danh sách 10 đội đầu tiên:');
    console.log(wcTeams.slice(0, 10));
  } else {
    console.log('Không có đội tuyển WC nào.');
  }

  const wcMatches = await queryAll(db, "SELECT COUNT(*) as count FROM matches WHERE league = 'WC'");
  console.log(`🥅 Số lượng trận đấu WC trong DB: ${wcMatches[0].count}`);
}

main().catch(console.error);
