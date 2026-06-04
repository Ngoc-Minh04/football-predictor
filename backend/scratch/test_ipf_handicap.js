import { buildBivariateScoreMatrix, buildNegativeBinomialScoreMatrix, blendScoreMatrices, calcResultProbs, calcOverUnder, calibrateMatrixIPF, getMostLikelyScoreConsistent } from '../models/poisson.js';

function runMathematicalTest() {
  console.log('--- BẮT ĐẦU KIỂM ĐỊNH TOÁN HỌC 3D IPF (8x8) ---');
  
  // 1. Khởi tạo Lambda ban đầu
  const homeLambda = 1.6;
  const awayLambda = 1.2;
  const lambda3 = 0.15;
  const nbR = 8;
  const bivariateWeight = 0.7;

  console.log(`\n1. Mô hình Poisson ban đầu:`);
  console.log(`   Lambda Home: ${homeLambda} | Lambda Away: ${awayLambda} | Lambda3: ${lambda3}`);

  const bivariateMatrix = buildBivariateScoreMatrix(homeLambda, awayLambda, lambda3);
  const nbMatrix = buildNegativeBinomialScoreMatrix(homeLambda, awayLambda, nbR);
  let scoreMatrix = blendScoreMatrices(bivariateMatrix, nbMatrix, bivariateWeight);

  const initProbs = calcResultProbs(scoreMatrix);
  const initOU = calcOverUnder(scoreMatrix);
  console.log(`   -> Xác suất 1X2 ban đầu: Thắng: ${(initProbs.home*100).toFixed(2)}% | Hòa: ${(initProbs.draw*100).toFixed(2)}% | Thua: ${(initProbs.away*100).toFixed(2)}%`);
  console.log(`   -> Tài/Xỉu 2.5 ban đầu: Tài: ${(initOU.over*100).toFixed(2)}% | Xỉu: ${(initOU.under*100).toFixed(2)}%`);

  // 2. Thiết lập mục tiêu hiệu chỉnh từ nhà cái (Target)
  // Giả sử nhà cái đánh giá Đội nhà cao hơn nữa và trận đấu ít bàn thắng hơn
  const target1X2 = { home: 0.50, draw: 0.28, away: 0.22 };
  const targetOU = { over: 0.40, under: 0.60 };
  const targetHandicap = {
    handicap: -0.5, // Chấp nửa trái
    upperProb: 0.50, // Xác suất thắng kèo Đội nhà
    lowerProb: 0.50  // Xác suất thắng kèo Đội khách
  };

  console.log(`\n2. Thiết lập mục tiêu hiệu chỉnh (Targets):`);
  console.log(`   -> 1X2 Target: Thắng: ${target1X2.home*100}% | Hòa: ${target1X2.draw*100}% | Thua: ${target1X2.away*100}%`);
  console.log(`   -> Tài/Xỉu Target: Tài: ${targetOU.over*100}% | Xỉu: ${targetOU.under*100}%`);
  console.log(`   -> Handicap Target (Chấp ${targetHandicap.handicap}): Đội nhà thắng kèo: ${targetHandicap.upperProb*100}% | Đội khách thắng kèo: ${targetHandicap.lowerProb*100}%`);

  // 3. Chạy thuật toán IPF 3D
  console.log(`\n3. Chạy thuật toán calibrateMatrixIPF...`);
  const calibrated = calibrateMatrixIPF(scoreMatrix, target1X2, targetOU, targetHandicap);

  // 4. Kiểm định kết quả sau hiệu chỉnh
  const finalProbs = calcResultProbs(calibrated);
  const finalOU = calcOverUnder(calibrated);
  const finalScore = getMostLikelyScoreConsistent(calibrated, finalProbs);

  // Tính xác suất handicap thực tế sau hiệu chỉnh
  let finalUpper = 0, finalLower = 0;
  // Hàm tính trọng số handicap châu Á
  function getHandicapWeights(homeGoals, awayGoals, handicap) {
    const d = homeGoals - awayGoals;
    const getSingleWeights = (H) => {
      const diff = d + H;
      if (diff > 0) return { home: 1.0, away: 0.0 };
      if (diff < 0) return { home: 0.0, away: 1.0 };
      return { home: 0.5, away: 0.5 };
    };
    if (Math.abs(handicap * 2) % 1 === 0) {
      const w = getSingleWeights(handicap);
      return { homeWeight: w.home, awayWeight: w.away };
    } else {
      const h1 = handicap - 0.25;
      const h2 = handicap + 0.25;
      const w1 = getSingleWeights(h1);
      const w2 = getSingleWeights(h2);
      return {
        homeWeight: (w1.home + w2.home) / 2,
        awayWeight: (w1.away + w2.away) / 2
      };
    }
  }

  for (let i = 0; i < calibrated.length; i++) {
    for (let j = 0; j < calibrated[i].length; j++) {
      const w = getHandicapWeights(i, j, targetHandicap.handicap);
      finalUpper += calibrated[i][j] * w.homeWeight;
      finalLower += calibrated[i][j] * w.awayWeight;
    }
  }

  // Tính tổng ma trận xem có bằng 1.0 không
  let totalSum = 0;
  for (let i = 0; i < calibrated.length; i++) {
    for (let j = 0; j < calibrated[i].length; j++) totalSum += calibrated[i][j];
  }

  console.log(`\n4. Kết quả kiểm định:`);
  console.log(`   -> Xác suất 1X2 sau IPF: Thắng: ${(finalProbs.home*100).toFixed(2)}% (Target: ${target1X2.home*100}%)`);
  console.log(`                            Hòa:   ${(finalProbs.draw*100).toFixed(2)}% (Target: ${target1X2.draw*100}%)`);
  console.log(`                            Thua:  ${(finalProbs.away*100).toFixed(2)}% (Target: ${target1X2.away*100}%)`);
  console.log(`   -> Tài/Xỉu 2.5 sau IPF:  Tài:   ${(finalOU.over*100).toFixed(2)}% (Target: ${targetOU.over*100}%)`);
  console.log(`                            Xỉu:   ${(finalOU.under*100).toFixed(2)}% (Target: ${targetOU.under*100}%)`);
  console.log(`   -> Handicap sau IPF:     Đội nhà: ${(finalUpper*100).toFixed(2)}% (Target: ${targetHandicap.upperProb*100}%)`);
  console.log(`                            Đội khách: ${(finalLower*100).toFixed(2)}% (Target: ${targetHandicap.lowerProb*100}%)`);
  console.log(`   -> Tổng ma trận tỷ số:   ${totalSum.toFixed(6)} (Yêu cầu: 1.000000)`);
  console.log(`   -> Tỷ số dự đoán chính xác nhất: ${finalScore.home} - ${finalScore.away}`);

  const isSuccess = 
    Math.abs(finalProbs.home - target1X2.home) < 0.01 &&
    Math.abs(finalOU.over - targetOU.over) < 0.01 &&
    Math.abs(finalUpper - targetHandicap.upperProb) < 0.01 &&
    Math.abs(totalSum - 1.0) < 1e-4;

  if (isSuccess) {
    console.log(`\n✅ KIỂM ĐỊNH TOÁN HỌC THÀNH CÔNG: Ma trận tỷ số 8x8 đã hội tụ chính xác với cả 3 chiều mục tiêu!`);
  } else {
    console.log(`\n❌ KIỂM ĐỊNH THẤT BẠI: Sai số hội tụ quá lớn.`);
  }
}

runMathematicalTest();
