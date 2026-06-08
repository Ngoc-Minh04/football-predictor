import { predict } from '../models/predictor.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TRAVEL DISTANCE & JET LAG FATIGUE...\n');

  // --- Test Case 1: Không di chuyển (Tại chỗ) ---
  console.log('--- TEST CASE 1: Không di chuyển (Tại chỗ ở Miami) ---');
  const resNoTravel = predict({
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
    venueCondition: 'normal',
    travelData: {
      currentCity: 'miami',
      homeLastCity: 'miami',
      awayLastCity: 'miami'
    }
  });

  const baseLambdaHome = resNoTravel.lambdas.home;
  const baseLambdaAway = resNoTravel.lambdas.away;
  console.log(`Bình thường: Lambda Nhà=${baseLambdaHome}, Lambda Khách=${baseLambdaAway}`);
  console.log(`Các yếu tố:`, resNoTravel.factors.map(f => f.factor));
  
  const hasTravelFactor1 = resNoTravel.factors.some(f => f.factor.includes('Di chuyển'));
  assert(!hasTravelFactor1, 'Không được có yếu tố di chuyển khi hai đội ở tại chỗ.');

  // --- Test Case 2: Di chuyển ngắn (Seattle -> Vancouver) ---
  console.log('\n--- TEST CASE 2: Di chuyển ngắn (Đội nhà: Seattle -> Vancouver, ~190km, 0 múi giờ) ---');
  const resShortTravel = predict({
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
    venueCondition: 'normal',
    travelData: {
      currentCity: 'vancouver',
      homeLastCity: 'seattle',
      awayLastCity: 'vancouver'
    }
  });

  console.log(`Di chuyển ngắn: Lambda Nhà=${resShortTravel.lambdas.home}, Lambda Khách=${resShortTravel.lambdas.away}`);
  console.log(`Các yếu tố:`, resShortTravel.factors.map(f => f.factor));

  const shortFactor = resShortTravel.factors.find(f => f.factor.includes('Di chuyển đội nhà') && f.factor.includes('phạt -2 ELO ảo & -0% xG'));
  assert(!!shortFactor, 'Đội nhà phải bị phạt nhẹ -2 ELO và 0% xG do di chuyển ngắn ~190km.');

  // --- Test Case 3: Di chuyển cực xa và lệch múi giờ (Vancouver -> Miami, ~4500km, 3 múi giờ) ---
  console.log('\n--- TEST CASE 3: Di chuyển cực xa (Đội khách: Vancouver -> Miami, ~4500km, 3 múi giờ) ---');
  const resLongTravel = predict({
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
    venueCondition: 'normal',
    travelData: {
      currentCity: 'miami',
      homeLastCity: 'miami',
      awayLastCity: 'vancouver'
    }
  });

  console.log(`Di chuyển xa: Lambda Nhà=${resLongTravel.lambdas.home}, Lambda Khách=${resLongTravel.lambdas.away}`);
  console.log(`Các yếu tố:`, resLongTravel.factors.map(f => f.factor));

  const longFactor = resLongTravel.factors.find(f => f.factor.includes('Di chuyển đội khách') && f.factor.includes('phạt -70 ELO ảo & -8% xG'));
  assert(!!longFactor, 'Đội khách phải bị phạt kịch trần -70 ELO và -8% xG do di chuyển cực xa.');
  assert(resLongTravel.lambdas.away < baseLambdaAway, 'Lambda Đội khách phải bị kéo giảm rõ rệt do phạt 8% xG.');

  console.log('\n✨ TẤT CẢ KIỂM THỬ CHO KHOẢNG CÁCH DI CHUYỂN & THỂ LỰC ĐÃ THÀNH CÔNG!');
}

runTests().catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
