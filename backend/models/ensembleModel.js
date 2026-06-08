/**
 * Ensemble Stacking Model
 * Combines statistical mathematical predictions, ELO values,
 * and bookmaker odds into a meta-prediction.
 */

// Optimal weights found through training
let ENSEMBLE_WEIGHTS = {
  copulaWeight: 0.65,
  eloWeight: 0.15,
  oddsWeight: 0.20
};

/**
 * Blend predictions from multiple subsystems using fitted weights
 * @param {object} copulaProbs - probabilities from Bivariate Copula {home, draw, away}
 * @param {object} eloProbs - probabilities calculated from ELO difference
 * @param {object} bookmakerProbs - probabilities from betting market odds
 * @returns {object} blended probabilities
 */
export function blendEnsemble(copulaProbs, eloProbs, bookmakerProbs) {
  const cW = ENSEMBLE_WEIGHTS.copulaWeight;
  const eW = ENSEMBLE_WEIGHTS.eloWeight;
  const oW = ENSEMBLE_WEIGHTS.oddsWeight;

  const hProbs = bookmakerProbs || copulaProbs; // Fallback if no odds exist

  const home = cW * copulaProbs.home + eW * eloProbs.home + oW * hProbs.home;
  const draw = cW * copulaProbs.draw + eW * eloProbs.draw + oW * hProbs.draw;
  const away = cW * copulaProbs.away + eW * eloProbs.away + oW * hProbs.away;

  const sum = home + draw + away;
  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum
  };
}

/**
 * Fits weights using a simplified batch Gradient Descent over historic training match results.
 */
export function trainStackingWeights(trainingData, iterations = 200, learningRate = 0.05) {
  let wC = ENSEMBLE_WEIGHTS.copulaWeight;
  let wE = ENSEMBLE_WEIGHTS.eloWeight;
  let wO = ENSEMBLE_WEIGHTS.oddsWeight;

  for (let iter = 0; iter < iterations; iter++) {
    let gradC = 0, gradE = 0, gradO = 0;

    for (const item of trainingData) {
      const { copula, elo, odds, outcome } = item; // outcome is one-hot {home: 0|1, draw: 0|1, away: 0|1}
      
      const predHome = wC * copula.home + wE * elo.home + wO * odds.home;
      const predDraw = wC * copula.draw + wE * elo.draw + wO * odds.draw;
      const predAway = wC * copula.away + wE * elo.away + wO * odds.away;

      // Squared errors gradients
      const errH = predHome - outcome.home;
      const errD = predDraw - outcome.draw;
      const errA = predAway - outcome.away;

      gradC += errH * copula.home + errD * copula.draw + errA * copula.away;
      gradE += errH * elo.home + errD * elo.draw + errA * elo.away;
      gradO += errH * odds.home + errD * odds.draw + errA * odds.away;
    }

    // Gradient descent step
    wC -= (learningRate * gradC) / trainingData.length;
    wE -= (learningRate * gradE) / trainingData.length;
    wO -= (learningRate * gradO) / trainingData.length;

    // Projection step to ensure weights sum to 1 and stay positive
    const sum = Math.max(0.01, wC + wE + wO);
    wC = Math.max(0, wC / sum);
    wE = Math.max(0, wE / sum);
    wO = Math.max(0, wO / sum);
  }

  ENSEMBLE_WEIGHTS = {
    copulaWeight: Math.round(wC * 100) / 100,
    eloWeight: Math.round(wE * 100) / 100,
    oddsWeight: Math.round(wO * 100) / 100
  };

  console.log(`[Ensemble Stacking] Trained Weights: Copula=${ENSEMBLE_WEIGHTS.copulaWeight}, ELO=${ENSEMBLE_WEIGHTS.eloWeight}, Odds=${ENSEMBLE_WEIGHTS.oddsWeight}`);
}
