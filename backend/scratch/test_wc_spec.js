import { predict } from '../models/predictor.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TÍNH NĂNG WORLD CUP 2026 CHUYÊN BIỆT...\n');

  // --- Test Case 1: Trận đấu World Cup bình thường (Không chủ nhà) ---
  console.log('--- TEST CASE 1: Trận WC bình thường (Pháp vs Anh, neutral) ---');
  const resNormal = predict({
    homeTeamId: 760, // Spain
    awayTeamId: 765, // Portugal
    homeTeamName: 'Spain',
    awayTeamName: 'Portugal',
    homeElo: 2000,
    awayElo: 1980,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
    targetLeague: 'WC',
  });

  console.log(`Home Advantage trả về: ${resNormal.homeAdvantage}`);
  assert(resNormal.homeAdvantage === 1.0, 'Trận trung lập bình thường phải có homeAdvantage = 1.0');
  const normalHasHostFactor = resNormal.factors.some(f => f.factor === 'Lợi thế quốc gia chủ nhà World Cup 2026');
  assert(!normalHasHostFactor, 'Trận bình thường không được có yếu tố chủ nhà WC 2026');


  // --- Test Case 2: Trận đấu có chủ nhà làm Đội nhà (USA vs Đức) ---
  console.log('\n--- TEST CASE 2: Trận có chủ nhà làm Đội nhà (USA vs Germany, neutral) ---');
  const resHostHome = predict({
    homeTeamId: 771, // USA
    awayTeamId: 759, // Germany
    homeTeamName: 'United States',
    awayTeamName: 'Germany',
    homeElo: 1850,
    awayElo: 1950,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
    targetLeague: 'WC',
  });

  console.log(`Home Advantage trả về: ${resHostHome.homeAdvantage}`);
  assert(resHostHome.homeAdvantage === 1.10, 'Đội chủ nhà WC (USA) đá sân nhà ở WC phải được nhận homeAdvantage = 1.10');
  const hostHasHostFactor = resHostHome.factors.some(f => f.factor === 'Lợi thế quốc gia chủ nhà World Cup 2026');
  assert(hostHasHostFactor, 'Đội chủ nhà WC phải có yếu tố chủ nhà WC 2026 trong danh sách factors');


  // --- Test Case 3: Trận đấu có chủ nhà bằng ID (Mexico vs Brazil) ---
  console.log('\n--- TEST CASE 3: Trận có chủ nhà xác định bằng ID (Mexico vs Brazil) ---');
  const resHostId = predict({
    homeTeamId: 769, // Mexico
    awayTeamId: 764, // Brazil
    homeTeamName: 'Mexico',
    awayTeamName: 'Brazil',
    homeElo: 1780,
    awayElo: 2020,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
    targetLeague: 'WC',
  });

  console.log(`Home Advantage trả về: ${resHostId.homeAdvantage}`);
  assert(resHostId.homeAdvantage === 1.10, 'Đội chủ nhà WC (Mexico theo ID 769) phải được nhận homeAdvantage = 1.10');


  // --- Test Case 4: Kiểm chứng Dynamic Decay phân tầng (Friendly vs WC) ---
  console.log('\n--- TEST CASE 4: Kiểm định Dynamic Decay phân tầng ---');
  
  // Giả lập ngày trận đấu mục tiêu là 2026-06-20
  // Trận 1: cách đây 3 ngày (2026-06-17), ghi 4 bàn (phong độ cực cao)
  // Trận 2: cách đây 45 ngày (2026-05-06), ghi 0 bàn (phong độ thấp)
  const matchDate = '2026-06-20';
  const recentDate1 = '2026-06-17';
  const recentDate2 = '2026-05-06';

  // Case 4A: Cả hai trận đều là giải WC (cùng giải đấu mục tiêu) -> tierFactor = 0.5 (decay chậm)
  // Trận 0 bàn cách đây 45 ngày vẫn còn trọng số lớn, kéo trung bình bàn thắng của đội nhà xuống
  const resDecayWC = predict({
    homeTeamId: 760,
    awayTeamId: 765,
    homeElo: 2000,
    awayElo: 2000,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    matchDate,
    homeRecentMatches: [
      {
        date: recentDate1,
        home_team_id: 760,
        away_team_id: 999,
        score_home: 4,
        score_away: 0,
        league: 'WC',
        home_elo: 2000,
        away_elo: 2000
      },
      {
        date: recentDate2,
        home_team_id: 760,
        away_team_id: 999,
        score_home: 0,
        score_away: 0,
        league: 'WC',
        home_elo: 2000,
        away_elo: 2000
      }
    ],
    awayRecentMatches: []
  });

  // Case 4B: Cả hai trận đều là giải Friendly (khác giải đấu mục tiêu WC) -> tierFactor = 3.5 (decay cực nhanh)
  // Trận 0 bàn cách đây 45 ngày sẽ bị phân rã hoàn toàn, trọng số gần như bằng 0
  // Phong độ sẽ nghiêng hẳn về trận thắng 4 bàn gần đây, kéo trung bình bàn thắng lên cao hơn
  const resDecayFriendly = predict({
    homeTeamId: 760,
    awayTeamId: 765,
    homeElo: 2000,
    awayElo: 2000,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    matchDate,
    homeRecentMatches: [
      {
        date: recentDate1,
        home_team_id: 760,
        away_team_id: 999,
        score_home: 4,
        score_away: 0,
        league: 'Friendly',
        home_elo: 2000,
        away_elo: 2000
      },
      {
        date: recentDate2,
        home_team_id: 760,
        away_team_id: 999,
        score_home: 0,
        score_away: 0,
        league: 'Friendly',
        home_elo: 2000,
        away_elo: 2000
      }
    ],
    awayRecentMatches: []
  });

  console.log(`Lambda Đội nhà khi các trận gần đây là WC (cùng giải, giữ trọng số trận 0 bàn): ${resDecayWC.lambdas.home} bàn`);
  console.log(`Lambda Đội nhà khi các trận gần đây là Giao hữu (phân rã trận cũ rất nhanh): ${resDecayFriendly.lambdas.home} bàn`);

  // Trận Giao hữu cũ bị phân rã biến mất nên Lambda sẽ cao hơn
  assert(resDecayFriendly.lambdas.home > resDecayWC.lambdas.home, 'Trận giao hữu ĐTQG cũ phải có decay nhanh hơn, khiến ảnh hưởng trận cũ biến mất nhanh hơn');

  console.log('\n✨ TẤT CẢ KIỂM THỬ CHO WORLD CUP 2026 ĐÃ THÀNH CÔNG RỰC RỠ!');
}

runTests().catch(err => {
  console.error('❌ Kiểm thử có lỗi:', err);
  process.exit(1);
});
