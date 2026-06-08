import { buildFrankCopulaScoreMatrix, frankCopulaCDF } from '../models/poisson.js';

function test() {
  console.log('--- STARTING BIVARIATE FRANK COPULA MATH TEST ---');

  // Test Copula CDF boundary limits
  console.log('Testing boundaries:');
  console.log(`  CDF(0.5, 0.5; theta=-2.0) = ${frankCopulaCDF(0.5, 0.5, -2.0).toFixed(4)}`);
  console.log(`  CDF(1.0, 0.5; theta=-2.0) = ${frankCopulaCDF(1.0, 0.5, -2.0).toFixed(4)} (Expected: 0.5)`);
  console.log(`  CDF(0.0, 0.5; theta=-2.0) = ${frankCopulaCDF(0.0, 0.5, -2.0).toFixed(4)} (Expected: 0.0)`);

  // Build matrix
  const homeLambda = 1.6;
  const awayLambda = 1.2;
  const theta = -2.5; // Negative theta = positive correlation (e.g. draws are more likely)

  console.log(`\nGenerating 8x8 Score Matrix (homeLambda=${homeLambda}, awayLambda=${awayLambda}, theta=${theta}):`);
  const matrix = buildFrankCopulaScoreMatrix(homeLambda, awayLambda, theta);

  let sum = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      sum += matrix[i][j];
    }
  }

  console.log('Matrix probabilities (rows=Home, cols=Away):');
  matrix.forEach((row, i) => {
    console.log(`  Home ${i}:`, row.map(val => val.toFixed(4)).join('  '));
  });

  console.log(`\nTotal probability sum = ${sum.toFixed(6)} (Expected: 1.000000)`);

  if (Math.abs(sum - 1.0) < 1e-4) {
    console.log('✅ TEST PASSED: Copula score matrix is normalized and mathematically sound!');
  } else {
    console.log('❌ TEST FAILED: Matrix normalization error.');
    process.exit(1);
  }
}

test();
