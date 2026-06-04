import axios from 'axios';

async function testIntegration() {
  console.log('🔗 Bắt đầu gửi API request tích hợp tới local server http://localhost:3001...');
  
  try {
    const response = await axios.post('http://localhost:3001/api/predict/prematch', {
      homeTeamId: 759, // France
      awayTeamId: 766, // Japan
      league: 'WC',
      matchDate: '2026-06-20',
      isNeutral: true,
      isKnockout: false,
      homeLineup: "France: Maignan, Kounde, Upamecano, Saliba, Theo Hernandez, Kante, Tchouameni, Rabiot, Dembele, Thuram, Giroud (Mbappe cất dự bị)",
      awayLineup: "Japan: Suzuki, Sugawara, Itakura, Machida, Ito, Endo, Morita, Doan, Minamino, Mitoma, Ueda",
      injuries: "France: Mbappe mệt mỏi nhẹ | Japan: Không có chấn thương"
    });

    console.log('\n✅ GỬI REQUEST THÀNH CÔNG! Đã nhận response:');
    console.log(`- Đội nhà: ${response.data.homeTeam} | Đội khách: ${response.data.awayTeam}`);
    console.log(`- Tỷ số dự đoán: ${response.data.score.home} - ${response.data.score.away}`);
    console.log(`- Xác suất 1X2: Thắng: ${response.data.result.home*100}% | Hòa: ${response.data.result.draw*100}% | Thua: ${response.data.result.away*100}%`);
    console.log(`- Lambdas: Đội nhà ${response.data.lambdas.home} bàn | Đội khách ${response.data.lambdas.away} bàn`);
    
    console.log('\n📊 Phân tích đội hình AI (aiLineupAnalysis):');
    console.log(response.data.aiLineupAnalysis || 'Không có phân tích đội hình.');

    console.log('\n📊 Yếu tố ảnh hưởng (factors):');
    response.data.factors.forEach(f => {
      console.log(`[${f.icon}] ${f.factor} (Impact: ${f.impact})`);
    });

    console.log('\n📊 Chi tiết định lượng gộp (aiContext):');
    console.log(response.data.aiContext);

  } catch (err) {
    console.error('❌ Gửi request thất bại:', err.response?.data || err.message);
    process.exit(1);
  }
}

testIntegration();
