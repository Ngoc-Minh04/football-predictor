import { calibrateMatrixIPF, buildFrankCopulaScoreMatrix, calcResultProbs } from '../models/poisson.js';

function test() {
  console.log('--- STARTING ASIAN HANDICAP IPF CALIBRATION TEST ---');

  // Margins
  const homeLambda = 1.6;
  const awayLambda = 1.2;
  const theta = -2.0;

  console.log('1. Building uncalibrated Frank Copula Matrix...');
  const baseMatrix = buildFrankCopulaScoreMatrix(homeLambda, awayLambda, theta);

  // Targets
  const target1X2 = { home: 0.52, draw: 0.24, away: 0.24 };
  const targetOU = { over25: 0.55, under25: 0.45 };
  const targetHandicap = {
    handicap: -0.75,
    upperProb: 0.58, // Home team coverage target probability
    lowerProb: 0.42  // Away team coverage target probability
  };

  console.log('2. Running IPF Calibration...');
  const calibrated = calibrateMatrixIPF(baseMatrix, target1X2, targetOU, targetHandicap);

  // Calculate new probabilities from calibrated matrix
  const out1X2 = calcResultProbs(calibrated);
  
  // Calculate calibrated Asian Handicap distribution
  const size = calibrated.length;
  let outUpper = 0, outLower = 0;
  
  const getHandicapWeights = (homeGoals, awayGoals, handicap) => {
    const d = homeGoals - awayGoals;
    const diff1 = d + (handicap - 0.25);
    const diff2 = d + (handicap + 0.25);
    const w1 = diff1 > 0 ? 1.0 : (diff1 < 0 ? 0.0 : 0.5);
    const w2 = diff2 > 0 ? 1.0 : (diff2 < 0 ? 0.0 : 0.5);
    return {
      homeWeight: (w1 + w2) / 2,
      awayWeight: (1.0 - w1 + 1.0 - w2) / 2
    };
  };

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const w = getHandicapWeights(i, j, targetHandicap.handicap);
      outUpper += calibrated[i][j] * w.homeWeight;
      outLower += calibrated[i][j] * w.awayWeight;
    }
  }

  console.log('3. Calibration Results verification:');
  console.log(`  1X2 (Home/Draw/Away): Target [${target1X2.home}/${target1X2.draw}/${target1X2.away}] ➔ Calibrated [${out1X2.home.toFixed(3)}/${out1X2.draw.toFixed(3)}/${out1X2.away.toFixed(3)}]`);
  console.log(`  Asian Handicap Upper (Home cover): Target [${targetHandicap.upperProb}] ➔ Calibrated [${outUpper.toFixed(3)}]`);
  console.log(`  Asian Handicap Lower (Away cover): Target [${targetHandicap.lowerProb}] ➔ Calibrated [${outLower.toFixed(3)}]`);

  const totalProb = outUpper + outLower;
  console.log(`  Total Handicap Probability Sum = ${totalProb.toFixed(6)}`);

  const matchTarget = Math.abs(outUpper - targetHandicap.upperProb) < 0.05;
  if (matchTarget && Math.abs(totalProb - 1.0) < 1e-4) {
    console.log('✅ TEST PASSED: Matrix successfully calibrated to target Asian Handicap!');
  } else {
    console.log('❌ TEST FAILED: Target probability mismatch.');
    process.exit(1);
  }
}

test();
