import { getDatabase, queryGet, queryAll } from './backend/db/database.js';
import { predict } from './backend/models/predictor.js';

async function testMatch() {
  const db = await getDatabase();
  
  // 1. Lấy thông tin đội bóng
  const homeTeam = await queryGet(db, "SELECT * FROM teams WHERE name LIKE '%Manchester City%'");
  const awayTeam = await queryGet(db, "SELECT * FROM teams WHERE name LIKE '%Aston Villa%'");
  
  console.log('Home team in DB:', homeTeam);
  console.log('Away team in DB:', awayTeam);
  
  const matchDate = '2026-05-24';
  
  // 2. Lấy trung bình bàn thắng giải đấu trước ngày trận đấu (lọc theo mùa hiện tại và các trận đã đấu trước đó)
  const leagueAvgHomeRow = await queryGet(db,
    `SELECT AVG(CAST(score_home AS REAL)) as avg
     FROM matches
     WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
    ['PL', matchDate, 2025]
  );
  const leagueAvgAwayRow = await queryGet(db,
    `SELECT AVG(CAST(score_away AS REAL)) as avg
     FROM matches
     WHERE league = ? AND status = 'FINISHED' AND date < ? AND season = ?`,
    ['PL', matchDate, 2025]
  );
  const leagueAvgHome = leagueAvgHomeRow?.avg || 1.5;
  const leagueAvgAway = leagueAvgAwayRow?.avg || 1.2;

  // H2H trước ngày trận đấu
  const h2hMatches = await queryAll(db,
    `SELECT score_home, score_away FROM matches
     WHERE ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
       AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       AND date < ?
     ORDER BY date DESC LIMIT 5`,
    [homeTeam.id, awayTeam.id, awayTeam.id, homeTeam.id, matchDate]
  );

  let h2hAvgGoals = 0;
  if (h2hMatches.length > 0) {
    const totalGoals = h2hMatches.reduce((sum, hm) => sum + hm.score_home + hm.score_away, 0);
    h2hAvgGoals = totalGoals / h2hMatches.length;
  }

  // 6 trận gần nhất trước ngày trận đấu cho home team
  const homeRecentMatches = await queryAll(db,
    `SELECT * FROM matches
     WHERE (home_team_id = ? OR away_team_id = ?)
       AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       AND date < ?
     ORDER BY date DESC LIMIT 6`,
    [homeTeam.id, homeTeam.id, matchDate]
  );

  // 6 trận gần nhất trước ngày trận đấu cho away team
  const awayRecentMatches = await queryAll(db,
    `SELECT * FROM matches
     WHERE (home_team_id = ? OR away_team_id = ?)
       AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       AND date < ?
     ORDER BY date DESC LIMIT 6`,
    [awayTeam.id, awayTeam.id, matchDate]
  );

  // Tính rest days trước trận đấu
  function calcRestDays(target, last) {
    if (!last || !target) return 4;
    const diff = Math.round((new Date(target) - new Date(last)) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : 4;
  }
  const homeRestDays = calcRestDays(matchDate, homeRecentMatches[0]?.date);
  const awayRestDays = calcRestDays(matchDate, awayRecentMatches[0]?.date);

  // Fetch last 10 finished home matches for home team before this match
  const homeHomeMatches = await queryAll(db,
    `SELECT score_home, score_away FROM matches
     WHERE home_team_id = ? AND status = 'FINISHED' AND score_home IS NOT NULL AND score_away IS NOT NULL
       AND date < ?
     ORDER BY date DESC LIMIT 10`,
    [homeTeam.id, matchDate]
  );
  let homeWinRate = 0.5;
  if (homeHomeMatches.length > 0) {
    const wins = homeHomeMatches.filter(hm => hm.score_home > hm.score_away).length;
    homeWinRate = wins / homeHomeMatches.length;
  }

  const homeStats = await queryGet(db,
    'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
    [homeTeam.id, 2025]
  ) || { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 0, xGA: 0 };

  const awayStats = await queryGet(db,
    'SELECT * FROM team_stats WHERE team_id = ? AND season = ?',
    [awayTeam.id, 2025]
  ) || { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 0, xGA: 0 };

  // Chạy dự đoán
  const prediction = predict({
    homeStats,
    awayStats,
    homeRecentMatches,
    awayRecentMatches,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeElo: homeTeam.elo_rating || 1500,
    awayElo: awayTeam.elo_rating || 1500,
    leagueAvgHome,
    leagueAvgAway,
    situationalFactors: {},
    h2hAvgGoals,
    homeRestDays,
    awayRestDays,
    homeWinRate,
  });

  console.log('=== KẾT QUẢ DỰ ĐOÁN ===');
  console.log('Dự đoán tỷ số:', prediction.score);
  console.log('1X2 Probabilities:', prediction.result);
  console.log('O/U Prediction:', prediction.overUnder);
  
  process.exit(0);
}

testMatch().catch(err => {
  console.error(err);
  process.exit(1);
});
