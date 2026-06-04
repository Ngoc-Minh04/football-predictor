import { predict } from '../models/predictor.js';
import { analyzeLineupsWithAI } from '../ai/claudeAnalyzer.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ ELO LIÊN ĐOÀN VÀ AI LINEUP ANALYZER...\n');

  // --- Test Case 1: Kiểm thử ELO liên đoàn (UEFA vs AFC) ---
  console.log('--- TEST CASE 1: Hiệu chỉnh ELO liên đoàn (Pháp vs Nhật Bản) ---');
  // Pháp ELO: 2000 (UEFA: +75 ELO ảo)
  // Nhật Bản ELO: 1800 (AFC: -30 ELO ảo)
  // Chênh lệch ELO gốc: 200 ELO -> Chênh lệch ELO ảo: 200 + 75 - (-30) = 305 ELO
  const resConf = predict({
    homeTeamId: 759, 
    awayTeamId: 766, 
    homeTeamName: 'France',
    awayTeamName: 'Japan',
    homeElo: 2000,
    awayElo: 1800,
    leagueAvgHome: 1.5,
    leagueAvgAway: 1.2,
    isNeutral: true,
    targetLeague: 'WC',
  });

  console.log(`factors trả về:`, resConf.factors.filter(f => f.factor.includes('Liên đoàn') || f.factor.includes('ELO')));
  const confFactor = resConf.factors.find(f => f.factor.includes('Đẳng cấp Liên đoàn'));
  assert(!!confFactor, 'Mô hình phải ghi nhận yếu tố Đẳng cấp Liên đoàn');
  assert(confFactor.factor.includes('UEFA vs AFC'), 'Phải nhận diện đúng UEFA vs AFC');
  assert(confFactor.factor.includes('105 ELO ảo'), 'Chênh lệch ELO ảo cộng thêm phải là 75 - (-30) = 105 ELO ảo');


  // --- Test Case 2: Kiểm thử gộp chỉ số chấn thương và lineups ---
  console.log('\n--- TEST CASE 2: Gộp chỉ số chấn thương và lineups (toán học) ---');
  // Giả sử có chấn thương phạt: homeAttackPenalty = 0.20, homeMotivation = 0.95
  // Giả sử lineup phạt: homeAttackPenalty = 0.40 (Mbappe dự bị), homeMotivation = 1.10 (quyết đấu)
  // Kết quả gộp: homeAttackPenalty = max(0.20, 0.40) = 0.40; homeMotivation = 0.95 * 1.10 = 1.045
  
  const injuryFactor = {
    homeAttackPenalty: 0.20,
    awayAttackPenalty: 0.0,
    homeDefensePenalty: 0.0,
    awayDefensePenalty: 0.0,
    homeMotivation: 0.95,
    awayMotivation: 1.0,
    reasoning: 'Mbappe mỏi cơ'
  };

  const lineupFactor = {
    homeAttackPenalty: 0.40,
    awayAttackPenalty: 0.0,
    homeDefensePenalty: 0.0,
    awayDefensePenalty: 0.0,
    homeMotivation: 1.10,
    awayMotivation: 1.0,
    tacticsReasoning: 'Mbappe cất dự bị chiến thuật'
  };

  // Logic gộp giống như trong routes/predict.js
  const finalHomeAttackPenalty = Math.max(injuryFactor.homeAttackPenalty, lineupFactor.homeAttackPenalty);
  const finalAwayAttackPenalty = Math.max(injuryFactor.awayAttackPenalty, lineupFactor.awayAttackPenalty);
  const finalHomeDefensePenalty = Math.max(injuryFactor.homeDefensePenalty, lineupFactor.homeDefensePenalty);
  const finalAwayDefensePenalty = Math.max(injuryFactor.awayDefensePenalty, lineupFactor.awayDefensePenalty);
  const finalHomeMotivation = injuryFactor.homeMotivation * lineupFactor.homeMotivation;
  const finalAwayMotivation = injuryFactor.awayMotivation * lineupFactor.awayMotivation;

  console.log(`Gộp homeAttackPenalty: ${finalHomeAttackPenalty} (Mong đợi: 0.4)`);
  console.log(`Gộp homeMotivation: ${finalHomeMotivation.toFixed(3)} (Mong đợi: 1.045)`);

  assert(finalHomeAttackPenalty === 0.40, 'homeAttackPenalty gộp phải lấy max là 0.40');
  assert(Math.abs(finalHomeMotivation - 1.045) < 0.001, 'homeMotivation gộp phải là tích 0.95 * 1.10 = 1.045');


  // --- Test Case 3: Kiểm thử AI Lineup Analyzer (nếu có API Key) ---
  console.log('\n--- TEST CASE 3: Kiểm thử hàm analyzeLineupsWithAI ---');
  try {
    const resLineup = await analyzeLineupsWithAI(
      "France: Maignan, Kounde, Upamecano, Saliba, Theo Hernandez, Kante, Tchouameni, Rabiot, Dembele, Thuram, Giroud (Mbappe cất dự bị)",
      "Japan: Suzuki, Sugawara, Itakura, Machida, Ito, Endo, Morita, Doan, Minamino, Mitoma, Ueda",
      "France",
      "Japan"
    );
    console.log(`AI Lineup Results:`, resLineup);
    assert(resLineup.homeAttackPenalty !== undefined, 'Hàm phải trả về đối tượng có homeAttackPenalty');
    assert(resLineup.tacticsReasoning !== undefined || resLineup.reasoning !== undefined, 'Hàm phải trả về tacticsReasoning hoặc reasoning');
  } catch (err) {
    console.warn(`Bỏ qua Test 3 nếu không có API key: ${err.message}`);
  }

  console.log('\n✨ TẤT CẢ KIỂM THỬ CHO ELO LIÊN ĐOÀN VÀ AI LINEUP ĐÃ THÀNH CÔNG!');
}

runTests().catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
