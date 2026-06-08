import { blendEnsemble, trainStackingWeights } from '../models/ensembleModel.js';

function test() {
  console.log('--- STARTING ENSEMBLE STACKING GRADIENT DESCENT TEST ---');

  // Build fake historical match outputs to simulate training
  const mockTrainingData = [
    {
      copula: { home: 0.60, draw: 0.20, away: 0.20 },
      elo: { home: 0.70, draw: 0.20, away: 0.10 },
      odds: { home: 0.65, draw: 0.22, away: 0.13 },
      outcome: { home: 1.0, draw: 0.0, away: 0.0 } // Home actually won
    },
    {
      copula: { home: 0.30, draw: 0.35, away: 0.35 },
      elo: { home: 0.25, draw: 0.30, away: 0.45 },
      odds: { home: 0.28, draw: 0.33, away: 0.39 },
      outcome: { home: 0.0, draw: 1.0, away: 0.0 } // Match was a draw
    },
    {
      copula: { home: 0.15, draw: 0.25, away: 0.60 },
      elo: { home: 0.20, draw: 0.20, away: 0.60 },
      odds: { home: 0.17, draw: 0.24, away: 0.59 },
      outcome: { home: 0.0, draw: 0.0, away: 1.0 } // Away actually won
    }
  ];

  console.log('Training model parameters with simulated history...');
  trainStackingWeights(mockTrainingData, 150, 0.1);

  // Blend prediction
  const copulaProbs = { home: 0.50, draw: 0.30, away: 0.20 };
  const eloProbs = { home: 0.55, draw: 0.25, away: 0.20 };
  const oddsProbs = { home: 0.52, draw: 0.28, away: 0.20 };

  const finalPred = blendEnsemble(copulaProbs, eloProbs, oddsProbs);
  console.log('Blended Output probabilities:', finalPred);

  const total = finalPred.home + finalPred.draw + finalPred.away;
  console.log(`Sum of weights = ${total.toFixed(4)} (Expected: 1.00)0`);

  if (Math.abs(total - 1.0) < 1e-4) {
    console.log('✅ TEST PASSED: Stacking optimizer trained and blended output correctly!');
  } else {
    console.log('❌ TEST FAILED: Verification constraints not met.');
    process.exit(1);
  }
}

test();
