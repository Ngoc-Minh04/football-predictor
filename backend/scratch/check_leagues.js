import { getDatabase, queryAll } from '../db/database.js';

async function main() {
  const db = await getDatabase();
  const hosts = await queryAll(db, "SELECT id, name, elo_rating FROM teams WHERE name LIKE '%USA%' OR name LIKE '%United States%' OR name LIKE '%Mexico%' OR name LIKE '%Canada%'");
  console.log('Các đội tuyển chủ nhà tìm thấy:');
  console.log(hosts);
}

main().catch(console.error);
