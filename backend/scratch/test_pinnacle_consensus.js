import axios from 'axios';
import { getDatabase, queryGet, queryRun } from '../db/database.js';
import { fetchAndStoreOdds } from '../scrapers/oddsApi.js';
import dotenv from 'dotenv';

dotenv.config();

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ THẤT BẠI: ${message}`);
    process.exit(1);
  }
  console.log(`✅ THÀNH CÔNG: ${message}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ PINNACLE SHARP MONEY CONSENSUS...');

  const db = await getDatabase();

  // 1. Dọn dẹp dữ liệu cũ (nếu có)
  await queryRun(db, `DELETE FROM odds_cache WHERE match_id IN (99999, 99998)`);
  await queryRun(db, `DELETE FROM matches WHERE id IN (99999, 99998)`);
  await queryRun(db, `DELETE FROM teams WHERE id IN (99999, 99998, 99997, 99996)`);

  // 2. Thêm các đội kiểm thử vào CSDL
  await queryRun(db, `INSERT INTO teams (id, name, league) VALUES (99999, 'Pinnacle Test Home', 'PL')`);
  await queryRun(db, `INSERT INTO teams (id, name, league) VALUES (99998, 'Pinnacle Test Away', 'PL')`);
  await queryRun(db, `INSERT INTO teams (id, name, league) VALUES (99997, 'Fallback Test Home', 'PL')`);
  await queryRun(db, `INSERT INTO teams (id, name, league) VALUES (99996, 'Fallback Test Away', 'PL')`);

  // 3. Thêm các trận kiểm thử SCHEDULED vào CSDL
  const todayStr = new Date().toISOString().split('T')[0];
  await queryRun(db, `INSERT INTO matches (id, home_team_id, away_team_id, date, league, season, status) VALUES (99999, 99999, 99998, ?, 'PL', 2026, 'SCHEDULED')`, [todayStr]);
  await queryRun(db, `INSERT INTO matches (id, home_team_id, away_team_id, date, league, season, status) VALUES (99998, 99997, 99996, ?, 'PL', 2026, 'SCHEDULED')`, [todayStr]);

  // 4. Giả lập axios.get để trả về dữ liệu mock
  const originalGet = axios.get;
  const mockOddsData = [
    {
      commence_time: new Date().toISOString(),
      home_team: 'Pinnacle Test Home',
      away_team: 'Pinnacle Test Away',
      bookmakers: [
        {
          key: 'pinnacle',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Pinnacle Test Home', price: 1.5 },
                { name: 'Pinnacle Test Away', price: 6.0 },
                { name: 'Draw', price: 4.0 }
              ]
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', point: 2.5, price: 1.8 },
                { name: 'Under', point: 2.5, price: 2.0 }
              ]
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Pinnacle Test Home', point: -0.5, price: 1.9 },
                { name: 'Pinnacle Test Away', point: 0.5, price: 1.9 }
              ]
            },
            {
              key: 'correct_score',
              outcomes: [
                { name: 'Pinnacle Test Home 1-0', price: 6.0 },
                { name: 'Pinnacle Test Home 2-0', price: 7.0 },
                { name: 'Draw 0-0', price: 10.0 }
              ]
            }
          ]
        },
        {
          key: 'unibet',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Pinnacle Test Home', price: 1.6 },
                { name: 'Pinnacle Test Away', price: 5.5 },
                { name: 'Draw', price: 3.8 }
              ]
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', point: 2.5, price: 1.75 },
                { name: 'Under', point: 2.5, price: 2.05 }
              ]
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Pinnacle Test Home', point: -0.5, price: 1.85 },
                { name: 'Pinnacle Test Away', point: 0.5, price: 1.95 }
              ]
            },
            {
              key: 'correct_score',
              outcomes: [
                { name: 'Pinnacle Test Home 1-0', price: 5.5 },
                { name: 'Pinnacle Test Home 2-0', price: 6.5 },
                { name: 'Draw 0-0', price: 9.0 }
              ]
            }
          ]
        }
      ]
    },
    {
      commence_time: new Date().toISOString(),
      home_team: 'Fallback Test Home',
      away_team: 'Fallback Test Away',
      bookmakers: [
        {
          key: 'unibet',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Fallback Test Home', price: 2.0 },
                { name: 'Fallback Test Away', price: 3.0 },
                { name: 'Draw', price: 3.5 }
              ]
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', point: 2.5, price: 1.9 },
                { name: 'Under', point: 2.5, price: 1.9 }
              ]
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Fallback Test Home', point: -0.25, price: 1.9 },
                { name: 'Fallback Test Away', point: 0.25, price: 1.9 }
              ]
            },
            {
              key: 'correct_score',
              outcomes: [
                { name: 'Fallback Test Home 1-0', price: 8.0 },
                { name: 'Draw 0-0', price: 7.0 }
              ]
            }
          ]
        }
      ]
    }
  ];

  axios.get = async (url, config) => {
    return { data: mockOddsData };
  };

  // Cấu hình ODDS_API_KEY tạm thời để vượt qua điều kiện bỏ qua cào của oddsApi
  const oldKey = process.env.ODDS_API_KEY;
  process.env.ODDS_API_KEY = 'test_pinnacle_consensus_key';

  try {
    // 5. Chạy hàm cào và xử lý odds
    await fetchAndStoreOdds('PL');

    // 6. Kiểm định Match 1 (Có Pinnacle -> Phải dùng đúng tỷ lệ cược của Pinnacle)
    const match1Odds = await queryGet(db, `SELECT * FROM odds_cache WHERE match_id = 99999`);
    assert(!!match1Odds, 'Dữ liệu odds của trận đấu Pinnacle Test Home phải được lưu.');

    // Tính toán tỷ lệ cược sạch (no overround) cho Pinnacle:
    // H2H: pHome=1/1.5=0.6667, pDraw=1/4.0=0.25, pAway=1/6.0=0.1667 => overround=1.0833
    // expected home_prob = 0.6667 / 1.0833 = 0.6154
    const expectedHomeProb = (1 / 1.5) / (1 / 1.5 + 1 / 4.0 + 1 / 6.0);
    const expectedDrawProb = (1 / 4.0) / (1 / 1.5 + 1 / 4.0 + 1 / 6.0);
    const expectedAwayProb = (1 / 6.0) / (1 / 1.5 + 1 / 4.0 + 1 / 6.0);

    assert(Math.abs(match1Odds.home_prob - expectedHomeProb) < 0.001, `Tỷ lệ thắng đội nhà phải khớp Pinnacle (mong muốn ${expectedHomeProb.toFixed(4)}, thực tế ${match1Odds.home_prob.toFixed(4)})`);
    assert(Math.abs(match1Odds.draw_prob - expectedDrawProb) < 0.001, `Tỷ lệ hòa phải khớp Pinnacle (mong muốn ${expectedDrawProb.toFixed(4)}, thực tế ${match1Odds.draw_prob.toFixed(4)})`);
    assert(Math.abs(match1Odds.away_prob - expectedAwayProb) < 0.001, `Tỷ lệ thắng đội khách phải khớp Pinnacle (mong muốn ${expectedAwayProb.toFixed(4)}, thực tế ${match1Odds.away_prob.toFixed(4)})`);

    // Totals: pOver=1/1.8=0.5556, pUnder=1/2=0.5 => overround=1.0556
    // expected over25_prob = 0.5556 / 1.0556 = 0.5263
    const expectedOverProb = (1 / 1.8) / (1 / 1.8 + 1 / 2.0);
    assert(Math.abs(match1Odds.over25_prob - expectedOverProb) < 0.001, `Tỷ lệ Tài (Over 2.5) phải khớp Pinnacle (mong muốn ${expectedOverProb.toFixed(4)}, thực tế ${match1Odds.over25_prob.toFixed(4)})`);

    // Spreads
    assert(match1Odds.handicap_value === -0.5, `Giá trị Handicap phải là -0.5 (thực tế ${match1Odds.handicap_value})`);
    assert(Math.abs(match1Odds.handicap_home_prob - 0.5) < 0.001, `Tỷ lệ Handicap Home phải là 0.5 (thực tế ${match1Odds.handicap_home_prob})`);

    // Correct score odds (bảo đảm khớp giá trị gốc của Pinnacle)
    const csOdds = JSON.parse(match1Odds.correct_score_odds);
    assert(csOdds['1-0'] === 6.0, `Correct Score 1-0 phải khớp Pinnacle (mong muốn 6.0, thực tế ${csOdds['1-0']})`);
    assert(csOdds['2-0'] === 7.0, `Correct Score 2-0 phải khớp Pinnacle (mong muốn 7.0, thực tế ${csOdds['2-0']})`);
    assert(csOdds['0-0'] === 10.0, `Correct Score 0-0 phải khớp Pinnacle (mong muốn 10.0, thực tế ${csOdds['0-0']})`);

    console.log('🎉 TRẬN ĐẤU CÓ PINNACLE ĐÃ THÀNH CÔNG KIỂM THỬ TRỰC TIẾP!');

    // 7. Kiểm định Match 2 (Không có Pinnacle -> Phải fallback về Unibet bình thường)
    const match2Odds = await queryGet(db, `SELECT * FROM odds_cache WHERE match_id = 99998`);
    assert(!!match2Odds, 'Dữ liệu odds của trận đấu Fallback Test Home phải được lưu.');

    const expectedFallbackHomeProb = (1 / 2.0) / (1 / 2.0 + 1 / 3.5 + 1 / 3.0);
    assert(Math.abs(match2Odds.home_prob - expectedFallbackHomeProb) < 0.001, `Fallback: Tỷ lệ thắng đội nhà phải khớp Unibet (mong muốn ${expectedFallbackHomeProb.toFixed(4)}, thực tế ${match2Odds.home_prob.toFixed(4)})`);

    const csOddsFallback = JSON.parse(match2Odds.correct_score_odds);
    assert(csOddsFallback['1-0'] === 8.0, `Fallback Correct Score 1-0 phải khớp Unibet (mong muốn 8.0, thực tế ${csOddsFallback['1-0']})`);
    assert(csOddsFallback['0-0'] === 7.0, `Fallback Correct Score 0-0 phải khớp Unibet (mong muốn 7.0, thực tế ${csOddsFallback['0-0']})`);

    console.log('🎉 TRẬN ĐẤU KHÔNG CÓ PINNACLE ĐÃ THÀNH CÔNG FALLBACK SANG NHÀ CÁI KHÁC!');

  } finally {
    // Phục hồi ban đầu
    axios.get = originalGet;
    process.env.ODDS_API_KEY = oldKey;

    // Dọn dẹp CSDL
    await queryRun(db, `DELETE FROM odds_cache WHERE match_id IN (99999, 99998)`);
    await queryRun(db, `DELETE FROM matches WHERE id IN (99999, 99998)`);
    await queryRun(db, `DELETE FROM teams WHERE id IN (99999, 99998, 99997, 99996)`);
    console.log('🧹 ĐÃ DỌN DẸP SẠCH SẼ DỮ LIỆU ĐĂNG KÝ KIỂM THỬ.');
  }

  console.log('\n✨ TẤT CẢ KIỂM THỬ CHO PINNACLE SHARP MONEY CONSENSUS ĐÃ THÀNH CÔNG VÀ CHÍNH XÁC TOÁN HỌC!');
}

runTests().catch(err => {
  console.error('❌ Lỗi chạy kiểm thử Pinnacle Consensus:', err);
  process.exit(1);
});
