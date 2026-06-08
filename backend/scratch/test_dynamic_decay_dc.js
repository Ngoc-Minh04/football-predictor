import { solveDixonColesMLE } from '../utils/dixonColesSolver.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ DYNAMIC LEAGUE DECAY TUNING (DIXON-COLES)...\n');

  const teamIds = [1, 2, 3];
  const eloMap = { 1: 1500, 2: 1500, 3: 1500 };
  const targetDateStr = '2026-06-15';

  // Thiết lập 2 trận đấu cách đây 30 ngày:
  // - Trận 1: Vòng bảng World Cup (WC) - Đội 1 thắng Đội 2 với tỷ số 2-0.
  // - Trận 2: Giao hữu ĐTQG (Friendly) - Đội 1 thua Đội 3 với tỷ số 0-5.
  const mockMatches = [
    {
      home_team_id: 1,
      away_team_id: 2,
      score_home: 2,
      score_away: 0,
      xg_home: null,
      xg_away: null,
      league: 'WC',
      date: '2026-05-15' // Cách ngày dự báo 30 ngày
    },
    {
      home_team_id: 1,
      away_team_id: 3,
      score_home: 0,
      score_away: 5,
      xg_home: null,
      xg_away: null,
      league: 'Friendly',
      date: '2026-05-15' // Cách ngày dự báo 30 ngày
    }
  ];

  // Kịch bản 1: Không phân rã phân tầng (Hoặc targetLeague = Club giải khác)
  // Hai trận có trọng số ngang nhau (1.0). Đội 1 vừa ghi 2 bàn vừa thua 5 bàn.
  console.log('--- SCENARIO 1: Không có Phân Tầng Giải Đấu (Friendly & WC như nhau) ---');
  const resNoTier = solveDixonColesMLE(mockMatches, teamIds, targetDateStr, 30, eloMap, 0.0, 0.0045, 'PL');

  // Kịch bản 2: Có Phân Tầng Giải Đấu (targetLeague = 'WC')
  // Trận Friendly sẽ bị decay nhanh gấp 7 lần so với trận WC (tierFactor 3.5 vs 0.5)
  // Do đó, trận thua giao hữu 0-5 sẽ bị giảm trọng số cực kỳ mạnh.
  console.log('\n--- SCENARIO 2: Có Phân Tầng Giải Đấu (Mục tiêu World Cup) ---');
  const resWCTier = solveDixonColesMLE(mockMatches, teamIds, targetDateStr, 30, eloMap, 0.0, 0.02, 'WC'); // Sử dụng decay cao hơn để thấy rõ hiệu ứng

  console.log('Defence Đội 1 (No Tier):', resNoTier.strengths[1].defence);
  console.log('Defence Đội 1 (WC Tier):', resWCTier.strengths[1].defence);
  console.log('Defence Đội 3 (No Tier):', resNoTier.strengths[3].defence);
  console.log('Defence Đội 3 (WC Tier):', resWCTier.strengths[3].defence);

  // 1. Phòng ngự Đội 1 (Chỉ số defence càng bé là thủ càng tốt) phải tốt hơn trong WC Tier
  // vì trận thua giao hữu 0-5 bị chiết khấu nặng.
  assert(resWCTier.strengths[1].defence < resNoTier.strengths[1].defence,
    'Phòng ngự Đội 1 phải vững chắc hơn (chỉ số defence nhỏ hơn) dưới WC Tier do trận giao hữu thua 5 bàn bị phai nhạt nhanh chóng.');

  // 2. Phòng ngự Đội 3 (đội thắng 5-0 trận giao hữu) phải tệ hơn (chỉ số defence lớn hơn, tiến về 1.0)
  // vì trận thắng của họ bị phai nhạt và không có trận đấu khác giữ chân.
  assert(resWCTier.strengths[3].defence > resNoTier.strengths[3].defence,
    'Phòng ngự Đội 3 phải yếu đi (chỉ số defence tiến gần về 1.0) dưới WC Tier do trận giao hữu sạch lưới bị phai nhạt.');

  console.log('\n✨ TẤT CẢ KIỂM THỬ TOÁN HỌC CHO DYNAMIC LEAGUE DECAY TUNING TRONG DIXON-COLES ĐÃ THÀNH CÔNG!');
}

runTests().catch(err => {
  console.error('❌ Lỗi chạy kiểm thử:', err);
  process.exit(1);
});
