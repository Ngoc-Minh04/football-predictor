import { buildScoreMatrix, calibrateMatrixIPF, calcResultProbs, calcOverUnder } from '../models/poisson.js';

// Helper to calculate Handicap probabilities of a matrix for testing
function getAHProbs(matrix, handicap) {
  const size = matrix.length;
  let upper = 0, lower = 0;
  
  const getSingleWeights = (d, H) => {
    const diff = d + H;
    if (diff > 0) return { home: 1.0, away: 0.0 };
    if (diff < 0) return { home: 0.0, away: 1.0 };
    return { home: 0.5, away: 0.5 };
  };

  const getWeights = (d, H) => {
    if (Math.abs(H * 2) % 1 === 0) {
      const w = getSingleWeights(d, H);
      return { homeWeight: w.home, awayWeight: w.away };
    } else {
      const h1 = H - 0.25;
      const h2 = H + 0.25;
      const w1 = getSingleWeights(d, h1);
      const w2 = getSingleWeights(d, h2);
      return {
        homeWeight: (w1.home + w2.home) / 2,
        awayWeight: (w1.away + w2.away) / 2
      };
    }
  };

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const w = getWeights(i - j, handicap);
      upper += matrix[i][j] * w.homeWeight;
      lower += matrix[i][j] * w.awayWeight;
    }
  }

  return { upper, lower };
}

// Run test
function runTest() {
  console.log("=== BẮT ĐẦU KIỂM THỬ THUẬT TOÁN 3D IPF VỚI KÈO CHẤP CHÂU Á ===");

  const homeLambda = 1.7;
  const awayLambda = 1.1;
  const baseMatrix = buildScoreMatrix(homeLambda, awayLambda);

  console.log("\n1. Trạng thái cơ bản (trước hiệu chỉnh):");
  const base1X2 = calcResultProbs(baseMatrix);
  const baseOU = calcOverUnder(baseMatrix);
  const baseAH = getAHProbs(baseMatrix, -0.75); // test with -0.75 handicap

  console.log(`  1X2: Home: ${base1X2.home.toFixed(4)}, Draw: ${base1X2.draw.toFixed(4)}, Away: ${base1X2.away.toFixed(4)}`);
  console.log(`  O/U 2.5: Over: ${baseOU.over.toFixed(4)}, Under: ${baseOU.under.toFixed(4)}`);
  console.log(`  Handicap -0.75: Upper (Home cover): ${baseAH.upper.toFixed(4)}, Lower (Away cover): ${baseAH.lower.toFixed(4)}`);

  // Target values
  const target1X2 = { home: 0.55, draw: 0.22, away: 0.23 };
  const targetOU = { over: 0.62, under: 0.38 };
  const targetAH = { handicap: -0.75, upperProb: 0.46, lowerProb: 0.54 };

  console.log("\n2. Thiết lập mục tiêu hiệu chỉnh (Targets):");
  console.log(`  Target 1X2: Home: ${target1X2.home}, Draw: ${target1X2.draw}, Away: ${target1X2.away}`);
  console.log(`  Target O/U 2.5: Over: ${targetOU.over}, Under: ${targetOU.under}`);
  console.log(`  Target Handicap -0.75: Upper: ${targetAH.upperProb}, Lower: ${targetAH.lowerProb}`);

  // Calibrate
  console.log("\n3. Chạy 3D IPF...");
  const calibratedMatrix = calibrateMatrixIPF(baseMatrix, target1X2, targetOU, targetAH, 150);

  // Check results
  const res1X2 = calcResultProbs(calibratedMatrix);
  const resOU = calcOverUnder(calibratedMatrix);
  const resAH = getAHProbs(calibratedMatrix, -0.75);
  
  let totalSum = 0;
  for (let i = 0; i < calibratedMatrix.length; i++) {
    for (let j = 0; j < calibratedMatrix[i].length; j++) {
      totalSum += calibratedMatrix[i][j];
    }
  }

  console.log("\n4. Kết quả sau khi hiệu chỉnh (Calibrated):");
  console.log(`  Tổng xác suất ma trận (phải bằng 1.0): ${totalSum.toFixed(6)}`);
  console.log(`  1X2: Home: ${res1X2.home.toFixed(4)} (Target: ${target1X2.home})`);
  console.log(`  1X2: Draw: ${res1X2.draw.toFixed(4)} (Target: ${target1X2.draw})`);
  console.log(`  1X2: Away: ${res1X2.away.toFixed(4)} (Target: ${target1X2.away})`);
  console.log(`  O/U 2.5: Over: ${resOU.over.toFixed(4)} (Target: ${targetOU.over})`);
  console.log(`  O/U 2.5: Under: ${resOU.under.toFixed(4)} (Target: ${targetOU.under})`);
  console.log(`  Handicap -0.75: Upper: ${resAH.upper.toFixed(4)} (Target: ${targetAH.upperProb})`);
  console.log(`  Handicap -0.75: Lower: ${resAH.lower.toFixed(4)} (Target: ${targetAH.lowerProb})`);

  // Assertions / tolerance check
  const tol = 1e-3;
  const ok1X2 = Math.abs(res1X2.home - target1X2.home) < tol && Math.abs(res1X2.draw - target1X2.draw) < tol && Math.abs(res1X2.away - target1X2.away) < tol;
  const okOU = Math.abs(resOU.over - targetOU.over) < tol && Math.abs(resOU.under - targetOU.under) < tol;
  const okAH = Math.abs(resAH.upper - targetAH.upperProb) < tol && Math.abs(resAH.lower - targetAH.lowerProb) < tol;
  const okSum = Math.abs(totalSum - 1.0) < 1e-6;

  console.log("\n5. Đánh giá kiểm thử:");
  console.log(`  - Chuẩn hóa ma trận (Sum=1.0): ${okSum ? "ĐẠT (PASS)" : "HỎNG (FAIL)"}`);
  console.log(`  - Hội tụ ràng buộc 1X2: ${ok1X2 ? "ĐẠT (PASS)" : "HỎNG (FAIL)"}`);
  console.log(`  - Hội tụ ràng buộc O/U 2.5: ${okOU ? "ĐẠT (PASS)" : "HỎNG (FAIL)"}`);
  console.log(`  - Hội tụ ràng buộc Handicap: ${okAH ? "ĐẠT (PASS)" : "HỎNG (FAIL)"}`);

  if (okSum && ok1X2 && okOU && okAH) {
    console.log("\n🎉 THÀNH CÔNG: Mọi kiểm thử đối với thuật toán 3D IPF đều vượt qua thành công!");
    process.exit(0);
  } else {
    console.log("\n❌ THẤT BẠI: Một hoặc nhiều kiểm thử không hội tụ đủ chính xác.");
    process.exit(1);
  }
}

runTest();
