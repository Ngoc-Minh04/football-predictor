import { solveDixonColesMLE } from '../utils/dixonColesSolver.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ XG-BLENDED DIXON-COLES SOLVER...\n');

  const teamIds = [1, 2, 3];
  const eloMap = { 1: 1500, 2: 1500, 3: 1500 };
  const targetDateStr = '2026-06-05';

  // Mock matches where:
  // Team 1 scores actual goals 3 against Team 2, but has xG 1.0
  // Team 2 scores actual goals 0, but has xG 2.0
  // Team 3 has normal matches
  const mockMatches = [
    {
      home_team_id: 1,
      away_team_id: 2,
      score_home: 3,
      score_away: 0,
      xg_home: 1.0,
      xg_away: 2.0,
      date: '2026-06-01'
    },
    {
      home_team_id: 2,
      away_team_id: 3,
      score_home: 1,
      score_away: 1,
      xg_home: 1.1,
      xg_away: 0.9,
      date: '2026-06-02'
    },
    {
      home_team_id: 3,
      away_team_id: 1,
      score_home: 2,
      score_away: 2,
      xg_home: 1.8,
      xg_away: 2.2,
      date: '2026-06-03'
    }
  ];

  // Test Case 1: xGBlendWeight = 0.0 (Actual goals only)
  console.log('--- TEST CASE 1: xGBlendWeight = 0.0 (Chỉ dùng bàn thắng thực tế) ---');
  const resGoalsOnly = solveDixonColesMLE(mockMatches, teamIds, targetDateStr, 30, eloMap, 0.0);
  console.log('Sức mạnh Goals Only:', resGoalsOnly.strengths);

  // Test Case 2: xGBlendWeight = 1.0 (xG only)
  console.log('\n--- TEST CASE 2: xGBlendWeight = 1.0 (Chỉ dùng xG) ---');
  const resXgOnly = solveDixonColesMLE(mockMatches, teamIds, targetDateStr, 30, eloMap, 1.0);
  console.log('Sức mạnh xG Only:', resXgOnly.strengths);

  // Team 1 had 3 actual goals vs Team 2 but only 1.0 xG.
  // Therefore, Team 1's attack strength should be significantly HIGHER in resGoalsOnly than in resXgOnly!
  assert(resGoalsOnly.strengths[1].attack > resXgOnly.strengths[1].attack, 
    `Sức mạnh tấn công đội 1 dùng Goals Only (${resGoalsOnly.strengths[1].attack.toFixed(3)}) phải lớn hơn dùng xG Only (${resXgOnly.strengths[1].attack.toFixed(3)})`);

  // Test Case 3: xGBlendWeight = 0.5 (Blend of both)
  console.log('\n--- TEST CASE 3: xGBlendWeight = 0.5 (Pha trộn 50/50) ---');
  const resBlended = solveDixonColesMLE(mockMatches, teamIds, targetDateStr, 30, eloMap, 0.5);
  console.log('Sức mạnh Blended 50/50:', resBlended.strengths);

  // The blended attack strength of Team 1 should lie strictly between Goals Only and xG Only!
  const attGoals = resGoalsOnly.strengths[1].attack;
  const attXg = resXgOnly.strengths[1].attack;
  const attBlend = resBlended.strengths[1].attack;
  
  assert(
    (attBlend > attXg && attBlend < attGoals) || (attBlend < attXg && attBlend > attGoals),
    `Sức mạnh tấn công blended (${attBlend.toFixed(3)}) phải nằm giữa Goals Only (${attGoals.toFixed(3)}) và xG Only (${attXg.toFixed(3)})`
  );

  // Test Case 4: Fallback cơ chế khi khuyết xG
  console.log('\n--- TEST CASE 4: Khuyết xG (xg_home = null, xg_away = null) ---');
  const mockMatchesMissingXG = [
    {
      home_team_id: 1,
      away_team_id: 2,
      score_home: 3,
      score_away: 0,
      xg_home: null,
      xg_away: null,
      date: '2026-06-01'
    },
    {
      home_team_id: 2,
      away_team_id: 3,
      score_home: 1,
      score_away: 1,
      xg_home: null,
      xg_away: null,
      date: '2026-06-02'
    },
    {
      home_team_id: 3,
      away_team_id: 1,
      score_home: 2,
      score_away: 2,
      xg_home: null,
      xg_away: null,
      date: '2026-06-03'
    }
  ];

  const resMissingXGBlend = solveDixonColesMLE(mockMatchesMissingXG, teamIds, targetDateStr, 30, eloMap, 0.5);
  const resMissingXGGoalsOnly = solveDixonColesMLE(mockMatchesMissingXG, teamIds, targetDateStr, 30, eloMap, 0.0);

  // When xG is missing, blending 0.5 should produce IDENTICAL results to Goals Only (0.0)
  assert(Math.abs(resMissingXGBlend.strengths[1].attack - resMissingXGGoalsOnly.strengths[1].attack) < 1e-5,
    'Khi thiếu dữ liệu xG, kết quả giải của blended 50/50 phải giống hệt Goals Only.');

  console.log('\n✨ TẤT CẢ KIỂM THỬ TOÁN HỌC CHO XG-BLENDED DIXON-COLES SOLVER ĐÃ THÀNH CÔNG!');
}

runTests().catch(err => {
  console.error('❌ Lỗi chạy kiểm thử:', err);
  process.exit(1);
});
