import dotenv from 'dotenv';
dotenv.config();

import { predict } from '../models/predictor.js';

function runScenario(title, params) {
  console.log(`\n🏆 KỊCH BẢN: ${title}`);
  
  const defaultParams = {
    homeStats: { goals_scored: 10, goals_conceded: 5, matches_played: 6, xG: 9.5, xGA: 5.2 },
    awayStats: { goals_scored: 12, goals_conceded: 4, matches_played: 6, xG: 11.2, xGA: 4.8 },
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeTeamId: 1,
    awayTeamId: 2,
    homeElo: 1500,
    awayElo: 1500,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    situationalFactors: {},
    h2hAvgGoals: 0,
    h2hRecentResults: [],
    homeRestDays: 5,
    awayRestDays: 5,
    homeWinRate: 0.6,
    matchDate: '2026-06-20',
    isNeutral: false,
    isKnockout: false
  };

  const finalParams = { ...defaultParams, ...params };
  const res = predict(finalParams);

  console.log(`- ELO: Đội nhà ${finalParams.homeElo} vs Đội khách ${finalParams.awayElo} (Chênh lệch: ${Math.abs(finalParams.homeElo - finalParams.awayElo)})`);
  console.log(`- Lambdas ban đầu (trước H2H/Knockout): HOME=${res.lambdas.home} | AWAY=${res.lambdas.away}`);
  
  const factorsList = res.factors.map(f => `${f.icon} ${f.factor} (impact: ${f.impact})`).join('\n  ');
  if (factorsList) {
    console.log(`- Các yếu tố ảnh hưởng:\n  ${factorsList}`);
  } else {
    console.log(`- Các yếu tố ảnh hưởng: Không có`);
  }
  
  console.log(`- Dự đoán tỷ số: ${res.score.home} - ${res.score.away}`);
  console.log(`- Xác suất kết quả (1X2): Thắng: ${Math.round(res.result.home*100)}% | Hòa: ${Math.round(res.result.draw*100)}% | Thua: ${Math.round(res.result.away*100)}%`);
}

function testDynamicMath() {
  console.log('======================================================');
  console.log('    KIỂM THỬ TƯƠNG QUAN BÀN THẮNG & H2H SCALE LAMBDA  ');
  console.log('======================================================');

  // Scenario 1: Hai đội ELO bằng nhau, không Knockout (Cân tài cân sức -> Lambda 3 phải lớn)
  runScenario("Hai đội ELO bằng nhau (1600 vs 1600) - Tương quan lambda3 cao", {
    homeElo: 1600,
    awayElo: 1600,
    isKnockout: false
  });

  // Scenario 2: Hai đội ELO bằng nhau, có Knockout (Cân tài cân sức + Sinh tử -> Lambda 3 cực đại)
  runScenario("Hai đội ELO bằng nhau (1600 vs 1600) + TRẬN KNOCKOUT - Lambda3 cực đại", {
    homeElo: 1600,
    awayElo: 1600,
    isKnockout: true
  });

  // Scenario 3: Chênh lệch ELO lớn (1900 vs 1400) - Tương quan lambda3 thấp
  runScenario("Chênh lệch ELO lớn (1900 vs 1400) - Thế trận một chiều, lambda3 thấp", {
    homeElo: 1900,
    awayElo: 1400,
    isKnockout: false
  });

  // Scenario 4: Có lịch sử đối đầu H2H (Đội nhà áp đảo ghi bàn trong quá khứ)
  // Giả sử Đội nhà ghi trung bình 3 bàn/trận trong 3 trận đối đầu gần đây
  const h2hMatchesDominantHome = [
    { homeGoals: 3, awayGoals: 0 },
    { homeGoals: 2, awayGoals: 1 },
    { homeGoals: 4, awayGoals: 1 }
  ];
  runScenario("Đội nhà áp đảo ghi bàn trong đối đầu lịch sử (H2H H.Goals: 3, 2, 4)", {
    homeElo: 1600,
    awayElo: 1600,
    h2hRecentResults: h2hMatchesDominantHome
  });

  // Scenario 5: Có lịch sử đối đầu H2H (Đội khách áp đảo ghi bàn trong quá khứ)
  const h2hMatchesDominantAway = [
    { homeGoals: 0, awayGoals: 2 },
    { homeGoals: 1, awayGoals: 3 },
    { homeGoals: 0, awayGoals: 3 }
  ];
  runScenario("Đội khách áp đảo ghi bàn trong đối đầu lịch sử (H2H A.Goals: 2, 3, 3)", {
    homeElo: 1600,
    awayElo: 1600,
    h2hRecentResults: h2hMatchesDominantAway
  });
}

testDynamicMath();
