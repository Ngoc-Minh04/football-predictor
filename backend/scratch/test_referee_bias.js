import { predict } from '../models/predictor.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ REFEREE STYLISTIC BIAS MODULATOR...\n');

  const baseParams = {
    homeTeamId: 1,
    awayTeamId: 2,
    homeElo: 1800,
    awayElo: 1800,
    homeTeamName: 'France',
    awayTeamName: 'Japan',
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.5,
    isNeutral: true,
    targetLeague: 'WC',
    weather: 'fine'
  };

  // --- Test Case 1: normal ---
  console.log('--- TEST CASE 1: Referee normal (Bình thường) ---');
  const resNormal = predict({ ...baseParams, referee: 'normal' });
  const baseHome = resNormal.lambdas.home;
  const baseAway = resNormal.lambdas.away;
  console.log(`Normal Lambdas: Home=${baseHome.toFixed(4)}, Away=${baseAway.toFixed(4)}`);

  const hasRefereeFactorNormal = resNormal.factors.some(f => f.factor.includes('Trọng tài'));
  assert(!hasRefereeFactorNormal, 'Không được có yếu tố trọng tài hiển thị khi chọn normal.');

  // --- Test Case 2: strict ---
  console.log('\n--- TEST CASE 2: Referee strict (Nghiêm khắc, +6% Lambda) ---');
  const resStrict = predict({ ...baseParams, referee: 'strict' });
  const strictHome = resStrict.lambdas.home;
  const strictAway = resStrict.lambdas.away;
  console.log(`Strict Lambdas: Home=${strictHome.toFixed(4)}, Away=${strictAway.toFixed(4)}`);

  // Phép so khớp dung sai 0.015 do Lambda trả về từ predict() bị làm tròn đến 2 chữ số thập phân
  assert(Math.abs(strictHome - baseHome * 1.06) < 0.015, 'Home Lambda của Strict phải tăng chính xác +6%');
  assert(Math.abs(strictAway - baseAway * 1.06) < 0.015, 'Away Lambda của Strict phải tăng chính xác +6%');
  
  const strictFactor = resStrict.factors.find(f => f.factor.includes('Trọng tài nghiêm khắc') && f.factor.includes('+6%'));
  assert(!!strictFactor, 'Yếu tố trọng tài nghiêm khắc hiển thị chính xác trên UI.');

  // --- Test Case 3: lenient ---
  console.log('\n--- TEST CASE 3: Referee lenient (Khoan dung, -7% Lambda) ---');
  const resLenient = predict({ ...baseParams, referee: 'lenient' });
  const lenientHome = resLenient.lambdas.home;
  const lenientAway = resLenient.lambdas.away;
  console.log(`Lenient Lambdas: Home=${lenientHome.toFixed(4)}, Away=${lenientAway.toFixed(4)}`);

  assert(Math.abs(lenientHome - baseHome * 0.93) < 0.015, 'Home Lambda của Lenient phải giảm chính xác -7%');
  assert(Math.abs(lenientAway - baseAway * 0.93) < 0.015, 'Away Lambda của Lenient phải giảm chính xác -7%');
  
  const lenientFactor = resLenient.factors.find(f => f.factor.includes('Trọng tài khoan dung') && f.factor.includes('-7%'));
  assert(!!lenientFactor, 'Yếu tố trọng tài khoan dung hiển thị chính xác trên UI.');

  // --- Test Case 4: home_biased (Trực tiếp không neutral, +5%/-5%) ---
  console.log('\n--- TEST CASE 4: Referee home_biased (Trận thường không neutral, +5%/-5%) ---');
  const resHomeBiasedNormal = predict({ ...baseParams, isNeutral: false, referee: 'home_biased' });
  
  const resNormalNonNeutral = predict({ ...baseParams, isNeutral: false, referee: 'normal' });
  const normalNonNeutralHome = resNormalNonNeutral.lambdas.home;
  const normalNonNeutralAway = resNormalNonNeutral.lambdas.away;

  const biasedNormalHome = resHomeBiasedNormal.lambdas.home;
  const biasedNormalAway = resHomeBiasedNormal.lambdas.away;
  console.log(`Non-neutral normal: Home=${normalNonNeutralHome.toFixed(4)}, Away=${normalNonNeutralAway.toFixed(4)}`);
  console.log(`Non-neutral biased: Home=${biasedNormalHome.toFixed(4)}, Away=${biasedNormalAway.toFixed(4)}`);

  assert(Math.abs(biasedNormalHome - normalNonNeutralHome * 1.05) < 0.015, 'Home Bias trận thường phải cộng +5% ELO/Lambda cho Đội nhà');
  assert(Math.abs(biasedNormalAway - normalNonNeutralAway * 0.95) < 0.015, 'Home Bias trận thường phải trừ -5% ELO/Lambda cho Đội khách');
  
  const homeBiasedFactorNormal = resHomeBiasedNormal.factors.find(f => f.factor.includes('Trọng tài thiên vị chủ nhà') && f.factor.includes('+5% công, -5% thủ'));
  assert(!!homeBiasedFactorNormal, 'Yếu tố áp lực chủ nhà trận thường hiển thị chính xác trên UI.');

  // --- Test Case 5: home_biased (Trung lập thường, +3%/-3%) ---
  console.log('\n--- TEST CASE 5: Referee home_biased (Trận trung lập không chủ nhà, +3%/-3%) ---');
  const resBiasedNeutralNormal = predict({ ...baseParams, isNeutral: true, referee: 'home_biased' });
  const biasedNeutralHome = resBiasedNeutralNormal.lambdas.home;
  const biasedNeutralAway = resBiasedNeutralNormal.lambdas.away;
  console.log(`Neutral normal: Home=${baseHome.toFixed(4)}, Away=${baseAway.toFixed(4)}`);
  console.log(`Neutral biased: Home=${biasedNeutralHome.toFixed(4)}, Away=${biasedNeutralAway.toFixed(4)}`);

  assert(Math.abs(biasedNeutralHome - baseHome * 1.03) < 0.015, 'Home Bias trận trung lập không chủ nhà phải cộng +3% cho Đội nhà');
  assert(Math.abs(biasedNeutralAway - baseAway * 0.97) < 0.015, 'Home Bias trận trung lập không chủ nhà phải trừ -3% cho Đội khách');
  
  const neutralBiasedFactor = resBiasedNeutralNormal.factors.find(f => f.factor.includes('Trọng tài thiên vị chủ nhà') && f.factor.includes('+3%/-3%'));
  assert(!!neutralBiasedFactor, 'Yếu tố áp lực chủ nhà trận trung lập hiển thị chính xác trên UI.');

  // --- Test Case 6: home_biased (Trung lập có nước chủ nhà WC2026, +6%/-6%) ---
  console.log('\n--- TEST CASE 6: Referee home_biased (Trận trung lập có chủ nhà Mỹ/Mexico/Canada, +6%/-6%) ---');
  const resBiasedHost = predict({ 
    ...baseParams, 
    homeTeamName: 'Mexico', 
    isNeutral: true, 
    referee: 'home_biased' 
  });
  
  const resNormalHost = predict({ 
    ...baseParams, 
    homeTeamName: 'Mexico', 
    isNeutral: true, 
    referee: 'normal' 
  });
  const normalHostHome = resNormalHost.lambdas.home;
  const normalHostAway = resNormalHost.lambdas.away;

  const biasedHostHome = resBiasedHost.lambdas.home;
  const biasedHostAway = resBiasedHost.lambdas.away;
  console.log(`Host neutral normal: Home=${normalHostHome.toFixed(4)}, Away=${normalHostAway.toFixed(4)}`);
  console.log(`Host neutral biased: Home=${biasedHostHome.toFixed(4)}, Away=${biasedHostAway.toFixed(4)}`);

  assert(Math.abs(biasedHostHome - normalHostHome * 1.06) < 0.015, 'Home Bias nước chủ nhà WC phải được cộng +6% công');
  assert(Math.abs(biasedHostAway - normalHostAway * 0.94) < 0.015, 'Home Bias nước chủ nhà WC phải bị trừ -6% thủ');
  
  const hostBiasedFactor = resBiasedHost.factors.find(f => f.factor.includes('Trọng tài thiên vị chủ nhà') && f.factor.includes('+6% công, -6% thủ'));
  assert(!!hostBiasedFactor, 'Yếu tố áp lực chủ nhà đối với nước đăng cai hiển thị chính xác trên UI.');

  console.log('\n✨ TẤT CẢ KIỂM THỬ TOÁN HỌC CHO REFEREE STYLISTIC BIAS ĐÃ THÀNH CÔNG VÀ CHÍNH XÁC!');
}

runTests().catch(err => {
  console.error('❌ Lỗi chạy kiểm thử:', err);
  process.exit(1);
});
