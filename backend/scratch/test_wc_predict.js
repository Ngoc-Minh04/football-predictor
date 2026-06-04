import { getDatabase, queryGet, queryAll } from '../db/database.js';
import { predict } from '../models/predictor.js';
import { parseInjuries } from '../utils/parseInjuries.js';

async function testScenario(scenarioName, homeTeamData, awayTeamData, homeElo, awayElo, injuriesText) {
  const db = await getDatabase();
  const matchDate = '2026-06-20';

  // Lấy statistics từ DB hoặc dùng default
  const homeStats = await queryGet(db, 'SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1', [homeTeamData.id]) || { goals_scored: 10, goals_conceded: 5, matches_played: 6, xG: 9.5, xGA: 5.2 };
  const awayStats = await queryGet(db, 'SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1', [awayTeamData.id]) || { goals_scored: 12, goals_conceded: 4, matches_played: 6, xG: 11.2, xGA: 4.8 };

  // Phân tích chấn thương
  const injuryFactor = parseInjuries(injuriesText, homeTeamData.name, awayTeamData.name);

  // Chạy mô hình dự đoán World Cup
  const pred = predict({
    homeStats,
    awayStats,
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeTeamId: homeTeamData.id,
    awayTeamId: awayTeamData.id,
    homeElo,
    awayElo,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    situationalFactors: {},
    h2hAvgGoals: 0,
    homeRestDays: 5,
    awayRestDays: 5,
    homeWinRate: 0.6,
    matchDate,
    isNeutral: true, // World Cup 2026 đá sân trung lập
    injuryFactor,
  });

  console.log(`\n🏆 Scenario: ${scenarioName}`);
  console.log(`⚔️  Trận đấu: ${homeTeamData.name} (ELO: ${homeElo}) vs ${awayTeamData.name} (ELO: ${awayElo})`);
  if (injuriesText) console.log(`🏥 Chấn thương: "${injuriesText}" -> Factors:`, injuryFactor);
  else console.log(`🏥 Chấn thương: Không có`);
  console.log(`⚽ Tỷ lệ thắng/hòa/thua (1X2): Thắng: ${Math.round(pred.result.home*100)}% | Hòa: ${Math.round(pred.result.draw*100)}% | Thua: ${Math.round(pred.result.away*100)}%`);
  console.log(`🥅 Dự đoán tỷ số: ${pred.score.home} - ${pred.score.away}`);
  console.log(`📊 Lambdas: ${homeTeamData.name}=${pred.lambdas.home} bàn | ${awayTeamData.name}=${pred.lambdas.away} bàn`);
}

async function testWCPredict() {
  const db = await getDatabase();
  
  // 1. Tìm ID các đội tuyển quốc gia
  const homeTeam = await queryGet(db, "SELECT * FROM teams WHERE name LIKE '%France%' OR name = 'France'");
  const awayTeam = await queryGet(db, "SELECT * FROM teams WHERE name LIKE '%England%' OR name = 'England'");
  
  let homeTeamData = homeTeam || { id: 9991, name: 'France', elo_rating: 2080 };
  let awayTeamData = awayTeam || { id: 9992, name: 'England', elo_rating: 2010 };

  // Đảm bảo lấy ELO thực tế từ DB (nếu có)
  const homeElo = homeTeamData.elo_rating || 2080;
  const awayElo = awayTeamData.elo_rating || 2010;

  // Scenario 1: Không chấn thương, ELO thực tế
  await testScenario("Không chấn thương, ELO thực tế (Pháp 2080 vs Anh 2010)", homeTeamData, awayTeamData, homeElo, awayElo, "");

  // Scenario 2: Có chấn thương (Mbappe chấn thương, Bellingham treo giò)
  await testScenario("Có chấn thương (Mbappe bên Pháp chấn thương, Bellingham bên Anh treo giò)", homeTeamData, awayTeamData, homeElo, awayElo, "Mbappe chấn thương đầu gối | Bellingham bị treo giò do thẻ phạt");

  // Scenario 3: Không chấn thương, ELO bằng nhau (để test xem ELO tác động thế nào)
  await testScenario("Không chấn thương, ELO bằng nhau (Pháp 2080 vs Anh 2080)", homeTeamData, awayTeamData, 2080, 2080, "");
}

testWCPredict().catch(err => console.error(err));
