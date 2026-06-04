import { initDatabase } from '../db/init.js';
import { queryAll, queryRun } from '../db/database.js';

async function fix() {
  const db = await initDatabase();
  console.log('[Fix] Đang đọc danh sách các đội và giải đấu từ lịch sử trận đấu...');

  // Lấy tất cả các đội
  const teams = await queryAll(db, 'SELECT id, name, league FROM teams');

  for (const team of teams) {
    // Tìm tất cả các giải đấu mà đội này đã tham gia trong bảng matches
    const matches = await queryAll(db, 
      'SELECT DISTINCT league FROM matches WHERE home_team_id = ? OR away_team_id = ?',
      [team.id, team.id]
    );

    // Gộp giải đấu hiện tại trong bảng teams và các giải đấu tìm thấy trong bảng matches
    const leagues = new Set();
    if (team.league) {
      team.league.split(',').forEach(l => {
        if (l.trim()) leagues.add(l.trim());
      });
    }
    matches.forEach(m => {
      if (m.league) leagues.add(m.league.trim());
    });

    const newLeagueStr = Array.from(leagues).join(',');

    if (newLeagueStr !== team.league) {
      console.log(`[Fix] Cập nhật đội "${team.name}" (${team.id}): "${team.league}" ➔ "${newLeagueStr}"`);
      await queryRun(db, 'UPDATE teams SET league = ? WHERE id = ?', [newLeagueStr, team.id]);
    }
  }

  console.log('[Fix] Hoàn thành cập nhật các giải đấu cho đội bóng!');
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
