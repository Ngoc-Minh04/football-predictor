import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, queryAll, queryGet } from '../db/database.js';
import { solveDixonColesMLE } from '../utils/dixonColesSolver.js';

async function compareDixonColes() {
  console.log('========================================================');
  console.log('    KIỂM THỬ SO SÁNH DIXON-COLES MLE MỚI VS CŨ          ');
  console.log('========================================================');

  const db = await getDatabase();

  // 1. Tìm giải đấu và mùa giải hoạt động có dữ liệu đã kết thúc
  const activeLeagueRow = await queryGet(db, 
    `SELECT league, season, COUNT(*) as count 
     FROM matches 
     WHERE status = 'FINISHED' 
     GROUP BY league, season 
     ORDER BY count DESC LIMIT 1`
  );

  if (!activeLeagueRow) {
    console.log('❌ Không tìm thấy dữ liệu trận đấu đã kết thúc trong CSDL. Vui lòng chạy seed data trước.');
    return;
  }

  const { league, season } = activeLeagueRow;
  console.log(`📊 Sử dụng dữ liệu giải: ${league} | Mùa: ${season} (Có ${activeLeagueRow.count} trận đã đá)`);

  const targetDateStr = '2026-06-30'; // Ngày tương lai để lấy toàn bộ trận đấu lịch sử

  // Load matches
  const matches = await queryAll(db,
    `SELECT home_team_id, away_team_id, score_home, score_away, date 
     FROM matches 
     WHERE league = ? AND season = ? AND status = 'FINISHED' 
       AND score_home IS NOT NULL AND score_away IS NOT NULL AND date < ?`,
    [league, season, targetDateStr]
  );

  // Load unique team IDs
  const matchTeams = await queryAll(db,
    `SELECT DISTINCT home_team_id as id FROM matches WHERE league = ? AND season = ?
     UNION
     SELECT DISTINCT away_team_id as id FROM matches WHERE league = ? AND season = ?`,
    [league, season, league, season]
  );
  
  const teamIds = matchTeams.map(t => Number(t.id));

  if (matches.length === 0 || teamIds.length === 0) {
    console.log('❌ Không đủ dữ liệu trận đấu hoặc đội bóng để giải Dixon-Coles.');
    return;
  }

  // Build eloMap
  const eloMap = {};
  const placeholders = teamIds.map(() => '?').join(',');
  const teamsData = await queryAll(db,
    `SELECT id, name, elo_rating FROM teams WHERE id IN (${placeholders})`,
    teamIds
  );
  
  const teamNames = {};
  teamsData.forEach(t => {
    eloMap[Number(t.id)] = t.elo_rating || 1500;
    teamNames[Number(t.id)] = t.name;
  });

  // 2. Chạy Solver CŨ (bằng cách truyền eloMap rỗng để tất cả ELO mặc định là 1500)
  const oldDC = solveDixonColesMLE(matches, teamIds, targetDateStr, 30, {});

  // 3. Chạy Solver MỚI (truyền eloMap thật)
  const newDC = solveDixonColesMLE(matches, teamIds, targetDateStr, 30, eloMap);

  console.log('\n⚖️  BẢNG SO SÁNH SỨC MẠNH TẤN CÔNG / PHÒNG NGỰ (TOP 10 ĐỘI):');
  console.log('------------------------------------------------------------------------------------------------------');
  console.log('Tên Đội              | ELO  | DC Cũ (Attack / Defence) | DC Mới (Attack / Defence) | Biến động Attack');
  console.log('------------------------------------------------------------------------------------------------------');

  // Lọc hiển thị Top 10 đội
  const displayIds = teamIds.slice(0, 10);
  displayIds.forEach(id => {
    const name = (teamNames[id] || `Đội ${id}`).padEnd(20, ' ');
    const elo = String(Math.round(eloMap[id] || 1500)).padStart(4, ' ');
    
    const oldAtt = oldDC.strengths[id].attack.toFixed(3);
    const oldDef = oldDC.strengths[id].defence.toFixed(3);
    const newAtt = newDC.strengths[id].attack.toFixed(3);
    const newDef = newDC.strengths[id].defence.toFixed(3);
    
    const attDiff = (newDC.strengths[id].attack - oldDC.strengths[id].attack);
    const diffSign = attDiff > 0 ? '+' : '';
    const diffStr = `${diffSign}${(attDiff*100).toFixed(1)}%`;
    
    console.log(`${name} | ${elo} | ${oldAtt}  /  ${oldDef}         | ${newAtt}  /  ${newDef}         | ${diffStr}`);
  });

  console.log('------------------------------------------------------------------------------------------------------');
  console.log(`- Home Advantage giải được: DC Cũ = ${oldDC.homeAdv.toFixed(3)} | DC Mới = ${newDC.homeAdv.toFixed(3)}`);
}

compareDixonColes().catch(err => console.error(err));
