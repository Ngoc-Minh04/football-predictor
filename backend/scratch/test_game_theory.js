import { predict } from '../models/predictor.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ GAME THEORY & GROUP STAGE SCENARIO MODULATOR...\n');

  const baseParams = {
    homeStats: { goals_scored: 20, goals_conceded: 15, matches_played: 14, xG: 20, xGA: 15 },
    awayStats: { goals_scored: 15, goals_conceded: 20, matches_played: 14, xG: 15, xGA: 20 },
    homeRecentMatches: [],
    awayRecentMatches: [],
    homeHomeRecentMatches: [],
    awayAwayRecentMatches: [],
    homeTeamId: 1,
    awayTeamId: 2,
    homeElo: 1800,
    awayElo: 1800,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    situationalFactors: {},
    h2hAvgGoals: 0,
    h2hRecentResults: [],
    homeRestDays: 4,
    awayRestDays: 4,
    homeWinRate: 0.5,
    matchDate: '2026-06-20',
    isNeutral: true,
    isKnockout: false,
    injuryFactor: {},
    dixonColesStrengths: null,
    weather: 'fine',
    referee: 'normal',
    targetLeague: 'WC',
    homeTeamName: 'France',
    awayTeamName: 'England',
    venueCondition: 'normal',
    travelData: null,
  };

  // 1. Baseline - normal scenario
  console.log('--- TEST CASE 1: Kịch bản bình thường (Normal) ---');
  const resNormal = predict({ ...baseParams, groupScenario: 'normal' });
  console.log(`Normal - Home Lambda: ${resNormal.lambdas.home.toFixed(4)}, Away Lambda: ${resNormal.lambdas.away.toFixed(4)}`);
  
  // 2. Home qualified rotation
  console.log('\n--- TEST CASE 2: Đội nhà chắc suất, xoay tua dưỡng sức ---');
  const resHomeRot = predict({ ...baseParams, groupScenario: 'home_qualified_rotation' });
  console.log(`HomeRot - Home Lambda: ${resHomeRot.lambdas.home.toFixed(4)}, Away Lambda: ${resHomeRot.lambdas.away.toFixed(4)}`);
  // Mong đợi: homeLambda = normal * 0.75, awayLambda = normal * 1.10
  const expectedHomeRotHome = resNormal.lambdas.home * 0.75;
  const expectedHomeRotAway = resNormal.lambdas.away * 1.10;
  assert(Math.abs(resHomeRot.lambdas.home - expectedHomeRotHome) < 0.015, `Home Lambda xoay tua phải giảm 25% (Mong đợi: ${expectedHomeRotHome.toFixed(2)}, Thực tế: ${resHomeRot.lambdas.home.toFixed(2)})`);
  assert(Math.abs(resHomeRot.lambdas.away - expectedHomeRotAway) < 0.015, `Away Lambda xoay tua phải tăng 10% (Mong đợi: ${expectedHomeRotAway.toFixed(2)}, Thực tế: ${resHomeRot.lambdas.away.toFixed(2)})`);
  assert(resHomeRot.factors.some(f => f.factor.includes('xoay tua')), 'Yêu cầu có nhân tố xoay tua dưỡng sức hiển thị trong factors.');

  // 3. Away qualified rotation
  console.log('\n--- TEST CASE 3: Đội khách chắc suất, xoay tua dưỡng sức ---');
  const resAwayRot = predict({ ...baseParams, groupScenario: 'away_qualified_rotation' });
  console.log(`AwayRot - Home Lambda: ${resAwayRot.lambdas.home.toFixed(4)}, Away Lambda: ${resAwayRot.lambdas.away.toFixed(4)}`);
  const expectedAwayRotHome = resNormal.lambdas.home * 1.10;
  const expectedAwayRotAway = resNormal.lambdas.away * 0.75;
  assert(Math.abs(resAwayRot.lambdas.home - expectedAwayRotHome) < 0.015, `Home Lambda phải tăng 10% do đối thủ xoay tua (Mong đợi: ${expectedAwayRotHome.toFixed(2)}, Thực tế: ${resAwayRot.lambdas.home.toFixed(2)})`);
  assert(Math.abs(resAwayRot.lambdas.away - expectedAwayRotAway) < 0.015, `Away Lambda phải giảm 25% do tự xoay tua (Mong đợi: ${expectedAwayRotAway.toFixed(2)}, Thực tế: ${resAwayRot.lambdas.away.toFixed(2)})`);

  // 4. Home must win big
  console.log('\n--- TEST CASE 4: Đội nhà buộc phải thắng đậm tranh hiệu số ---');
  const resHomeWinBig = predict({ ...baseParams, groupScenario: 'home_must_win_big' });
  console.log(`HomeWinBig - Home Lambda: ${resHomeWinBig.lambdas.home.toFixed(4)}, Away Lambda: ${resHomeWinBig.lambdas.away.toFixed(4)}`);
  // Mong đợi: homeLambda = normal * 1.20, awayLambda = normal * 1.30
  const expectedHomeWinBigHome = resNormal.lambdas.home * 1.20;
  const expectedHomeWinBigAway = resNormal.lambdas.away * 1.30;
  assert(Math.abs(resHomeWinBig.lambdas.home - expectedHomeWinBigHome) < 0.015, `Home Lambda phải tăng 20% do chơi tấn công tổng lực (Mong đợi: ${expectedHomeWinBigHome.toFixed(2)}, Thực tế: ${resHomeWinBig.lambdas.home.toFixed(2)})`);
  assert(Math.abs(resHomeWinBig.lambdas.away - expectedHomeWinBigAway) < 0.015, `Away Lambda phải tăng 30% do hàng thủ đối phương sơ hở dâng cao (Mong đợi: ${expectedHomeWinBigAway.toFixed(2)}, Thực tế: ${resHomeWinBig.lambdas.away.toFixed(2)})`);

  // 5. Away must win big
  console.log('\n--- TEST CASE 5: Đội khách buộc phải thắng đậm tranh hiệu số ---');
  const resAwayWinBig = predict({ ...baseParams, groupScenario: 'away_must_win_big' });
  console.log(`AwayWinBig - Home Lambda: ${resAwayWinBig.lambdas.home.toFixed(4)}, Away Lambda: ${resAwayWinBig.lambdas.away.toFixed(4)}`);
  const expectedAwayWinBigHome = resNormal.lambdas.home * 1.30;
  const expectedAwayWinBigAway = resNormal.lambdas.away * 1.20;
  assert(Math.abs(resAwayWinBig.lambdas.home - expectedAwayWinBigHome) < 0.015, `Home Lambda phải tăng 30% do đối thủ dâng cao (Mong đợi: ${expectedAwayWinBigHome.toFixed(2)}, Thực tế: ${resAwayWinBig.lambdas.home.toFixed(2)})`);
  assert(Math.abs(resAwayWinBig.lambdas.away - expectedAwayWinBigAway) < 0.015, `Away Lambda phải tăng 20% do chơi tấn công (Mong đợi: ${expectedAwayWinBigAway.toFixed(2)}, Thực tế: ${resAwayWinBig.lambdas.away.toFixed(2)})`);

  // 6. Collusive Draw
  console.log('\n--- TEST CASE 6: Thỏa hiệp hòa (Collusive Draw) ---');
  const resCollDraw = predict({ ...baseParams, groupScenario: 'collusive_draw' });
  console.log(`CollDraw - Home Lambda: ${resCollDraw.lambdas.home.toFixed(4)}, Away Lambda: ${resCollDraw.lambdas.away.toFixed(4)}`);
  
  // Mong đợi: home/away lambdas giảm 15%
  const expectedCollHome = resNormal.lambdas.home * 0.85;
  const expectedCollAway = resNormal.lambdas.away * 0.85;
  assert(Math.abs(resCollDraw.lambdas.home - expectedCollHome) < 0.015, `Home Lambda phải giảm 15% (Mong đợi: ${expectedCollHome.toFixed(2)}, Thực tế: ${resCollDraw.lambdas.home.toFixed(2)})`);
  assert(Math.abs(resCollDraw.lambdas.away - expectedCollAway) < 0.015, `Away Lambda phải giảm 15% (Mong đợi: ${expectedCollAway.toFixed(2)}, Thực tế: ${resCollDraw.lambdas.away.toFixed(2)})`);
  
  // Kiểm tra ZIP được áp dụng và tăng xác suất hòa không bàn thắng
  console.log(`Xác suất 0-0 Normal: ${(resNormal.scoreMatrix[0][0] * 100).toFixed(3)}%`);
  console.log(`Xác suất 0-0 Collusive Draw: ${(resCollDraw.scoreMatrix[0][0] * 100).toFixed(3)}%`);
  assert(resCollDraw.scoreMatrix[0][0] > resNormal.scoreMatrix[0][0], 'Xác suất tỷ số 0-0 ở kịch bản thỏa hiệp hòa phải cao hơn kịch bản bình thường.');
  
  // Xác minh tổng xác suất ma trận bảo toàn đúng 1.0
  let sumNormal = 0, sumColl = 0;
  for (let i = 0; i < resNormal.scoreMatrix.length; i++) {
    for (let j = 0; j < resNormal.scoreMatrix[i].length; j++) {
      sumNormal += resNormal.scoreMatrix[i][j];
      sumColl += resCollDraw.scoreMatrix[i][j];
    }
  }
  console.log(`Tổng ma trận Normal: ${sumNormal.toFixed(10)}`);
  console.log(`Tổng ma trận Collusive Draw: ${sumColl.toFixed(10)}`);
  assert(Math.abs(sumColl - 1.0) < 1e-9, 'Tổng xác suất ma trận tỷ số sau khi áp dụng lạm phát ZIP thỏa hiệp hòa phải bảo toàn bằng đúng 1.0');

  console.log('\n✨ TẤT CẢ KIỂM THỬ TOÁN HỌC CHO GAME THEORY SCENARIO MODULATOR ĐÃ THÀNH CÔNG RỰC RỠ!');
}

runTests().catch(err => {
  console.error('❌ Lỗi chạy kiểm thử:', err);
  process.exit(1);
});
