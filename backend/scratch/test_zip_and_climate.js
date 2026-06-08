import { predict } from '../models/predictor.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ ZIP VÀ HIỆU CHỈNH KHÍ HẬU/ĐỘ CAO...\n');

  // --- Test Case 1: Điều kiện bình thường (Normal) làm mốc so sánh ---
  console.log('--- TEST CASE 1: Điều kiện Sân thường (Anh vs Brazil) ---');
  const resNormal = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England', // UEFA
    awayTeamName: 'Brazil',  // CONMEBOL
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    venueCondition: 'normal'
  });

  const baseLambdaHome = resNormal.lambdas.home;
  const baseLambdaAway = resNormal.lambdas.away;
  const baseProb00 = resNormal.scoreMatrix[0][0];

  console.log(`Bình thường: Lambda Nhà=${baseLambdaHome}, Lambda Khách=${baseLambdaAway}, P(0,0)=${(baseProb00 * 100).toFixed(2)}%`);
  console.log(`Các yếu tố:`, resNormal.factors.map(f => f.factor));
  
  // --- Test Case 2: Độ cao lớn (High Altitude - Mexico City) ---
  console.log('\n--- TEST CASE 2: Độ cao lớn Mexico (High Altitude) ---');
  // Mong đợi:
  // - Anh (UEFA - không phải CONMEBOL) bị phạt -60 ELO ảo.
  // - Brazil (CONMEBOL) không bị phạt ELO.
  // - Cả hai đội bị giảm 8% xG.
  const resAltitude = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England',
    awayTeamName: 'Brazil',
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    venueCondition: 'high_altitude'
  });

  console.log(`Độ cao: Lambda Nhà=${resAltitude.lambdas.home}, Lambda Khách=${resAltitude.lambdas.away}, P(0,0)=${(resAltitude.scoreMatrix[0][0] * 100).toFixed(2)}%`);
  console.log(`Các yếu tố:`, resAltitude.factors.map(f => f.factor));

  const altitudeEloFactorHome = resAltitude.factors.find(f => f.factor.includes('England không quen độ cao') && f.factor.includes('-60 ELO ảo'));
  const altitudeEloFactorAway = resAltitude.factors.find(f => f.factor.includes('Brazil không quen độ cao'));
  const xgReductionFactor = resAltitude.factors.find(f => f.factor.includes('Giảm 8% bàn thắng kỳ vọng'));

  assert(!!altitudeEloFactorHome, 'Đội nhà (Anh - UEFA) phải bị phạt -60 ELO ảo do độ cao.');
  assert(!altitudeEloFactorAway, 'Đội khách (Brazil - CONMEBOL) không bị phạt ELO do độ cao.');
  assert(!!xgReductionFactor, 'Phải có yếu tố phạt giảm 8% bàn thắng kỳ vọng.');

  // Lambda phải nhỏ hơn do bị nhân 0.92 (và thêm tác động ELO penalty).
  // Vì Anh bị trừ ELO ảo, nên Lambda của Anh bị kéo xuống thêm, còn Brazil được lợi từ chênh lệch ELO nên Lambda có thể tăng/giảm nhẹ tùy theo độ cân bằng,
  // nhưng tổng quan xG bị giảm mạnh.
  assert(resAltitude.lambdas.home < baseLambdaHome, 'Lambda Đội nhà phải nhỏ hơn sân thường do phạt 8% xG + ELO phạt.');

  // --- Test Case 3: Nóng ẩm cực đoan (Hot Humid) ---
  console.log('\n--- TEST CASE 3: Nắng nóng ẩm cực đoan (Hot Humid) ---');
  // Mong đợi:
  // - Anh (UEFA) bị phạt -40 ELO ảo.
  // - Brazil (CONMEBOL - không phải UEFA) không bị phạt ELO.
  // - Cả hai đội bị giảm 6% xG.
  const resHotHumid = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England',
    awayTeamName: 'Brazil',
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    venueCondition: 'hot_humid'
  });

  console.log(`Nóng ẩm: Lambda Nhà=${resHotHumid.lambdas.home}, Lambda Khách=${resHotHumid.lambdas.away}, P(0,0)=${(resHotHumid.scoreMatrix[0][0] * 100).toFixed(2)}%`);
  console.log(`Các yếu tố:`, resHotHumid.factors.map(f => f.factor));

  const heatEloFactorHome = resHotHumid.factors.find(f => f.factor.includes('England (UEFA) chịu phạt nhiệt độ') && f.factor.includes('-40 ELO ảo'));
  const heatEloFactorAway = resHotHumid.factors.find(f => f.factor.includes('Brazil (UEFA) chịu phạt nhiệt độ'));
  const heatXgFactor = resHotHumid.factors.find(f => f.factor.includes('Giảm 6% bàn thắng kỳ vọng'));

  assert(!!heatEloFactorHome, 'Đội nhà (Anh - UEFA) phải bị phạt -40 ELO ảo do nóng ẩm.');
  assert(!heatEloFactorAway, 'Đội khách (Brazil - CONMEBOL) không bị phạt ELO do nóng ẩm.');
  assert(!!heatXgFactor, 'Phải có yếu tố phạt giảm 6% bàn thắng kỳ vọng.');

  // --- Test Case 4: Zero-Inflated Poisson (ZIP) 0-0 Model ---
  console.log('\n--- TEST CASE 4: Lạm phát tỷ số 0-0 (ZIP Model) ---');
  // So sánh trận đấu không ZIP (Giao hữu) vs trận đấu WC vòng bảng vs trận đấu WC Knockout
  const resFriendly = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England',
    awayTeamName: 'Brazil',
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'Friendly', // Không áp dụng ZIP
    isKnockout: false,
    venueCondition: 'normal'
  });

  const resWCGroup = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England',
    awayTeamName: 'Brazil',
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC', // Có áp dụng ZIP vòng bảng (pi = 0.03)
    isKnockout: false,
    venueCondition: 'normal'
  });

  const resWCKnockout = predict({
    homeTeamId: 1,
    awayTeamId: 2,
    homeTeamName: 'England',
    awayTeamName: 'Brazil',
    homeElo: 1900,
    awayElo: 1900,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC', // Có áp dụng ZIP Knockout (pi = 0.08)
    isKnockout: true,
    venueCondition: 'normal'
  });

  const prob00Friendly = resFriendly.scoreMatrix[0][0];
  const prob00Group = resWCGroup.scoreMatrix[0][0];
  const prob00Knockout = resWCKnockout.scoreMatrix[0][0];

  console.log(`Xác suất 0-0 Giao hữu (No ZIP): ${(prob00Friendly * 100).toFixed(3)}%`);
  console.log(`Xác suất 0-0 WC Group (ZIP pi~3%): ${(prob00Group * 100).toFixed(3)}%`);
  console.log(`Xác suất 0-0 WC Knockout (ZIP pi~8%): ${(prob00Knockout * 100).toFixed(3)}%`);

  // Assertions
  assert(prob00Group > prob00Friendly, 'Xác suất 0-0 của WC Group phải lớn hơn trận giao hữu không có ZIP.');
  assert(prob00Knockout > prob00Group, 'Xác suất 0-0 của WC Knockout phải lớn hơn WC Group.');

  // Kiểm tra tính bảo toàn xác suất của ma trận (Tổng sum = 1.0)
  function getMatrixSum(matrix) {
    let sum = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        sum += matrix[i][j];
      }
    }
    return sum;
  }

  const sumFriendly = getMatrixSum(resFriendly.scoreMatrix);
  const sumGroup = getMatrixSum(resWCGroup.scoreMatrix);
  const sumKnockout = getMatrixSum(resWCKnockout.scoreMatrix);

  console.log(`Tổng ma trận Giao hữu: ${sumFriendly}`);
  console.log(`Tổng ma trận WC Group: ${sumGroup}`);
  console.log(`Tổng ma trận WC Knockout: ${sumKnockout}`);

  assert(Math.abs(sumFriendly - 1.0) < 1e-9, 'Tổng xác suất ma trận Giao hữu phải bằng 1.0');
  assert(Math.abs(sumGroup - 1.0) < 1e-9, 'Tổng xác suất ma trận WC Group phải bằng 1.0');
  assert(Math.abs(sumKnockout - 1.0) < 1e-9, 'Tổng xác suất ma trận WC Knockout phải bằng 1.0');

  console.log('\n✨ TẤT CẢ KIỂM THỬ CHO ZIP VÀ KHÍ HẬU/ĐỘ CAO ĐÃ THÀNH CÔNG!');
}

runTests().catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
