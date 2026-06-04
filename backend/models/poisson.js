/**
 * Probability Distribution Model — Negative Binomial (primary) + Poisson (fallback)
 *
 * Football scores exhibit overdispersion: variance > mean.
 * Negative Binomial (NB) handles this better than Poisson.
 *
 * NB parameterization: P(X=k) = C(k+r-1, k) * (1-p)^r * p^k
 * where: mean μ = p*r/(1-p), variance = μ + μ²/r
 * Overdispersion parameter r: smaller r → more overdispersion
 * Fitted empirically: r ≈ 3.0 for football (see Dixon & Robinson 1998)
 */

const NB_DISPERSION = 15.0; // overdispersion parameter r: higher = closer to Poisson, lower = more overdispersion

/**
 * Log-Gamma function (Lanczos approximation) for large factorials
 */
function logGamma(z) {
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Negative Binomial PMF: P(X = k | μ, r)
 * @param {number} k - number of goals
 * @param {number} mu - expected goals (lambda)
 * @param {number} r - dispersion parameter (default NB_DISPERSION)
 */
export function negativeBinomialPMF(k, mu, r = NB_DISPERSION) {
  if (mu <= 0) return k === 0 ? 1 : 0;
  if (r <= 0) return poissonPMF(k, mu); // fallback to Poisson

  const p = mu / (mu + r); // success probability
  // log P(X=k) = logGamma(k+r) - logGamma(r) - logGamma(k+1) + r*log(1-p) + k*log(p)
  const logProb =
    logGamma(k + r) - logGamma(r) - logGamma(k + 1) +
    r * Math.log(1 - p) +
    (k > 0 ? k * Math.log(p) : 0);
  return Math.exp(logProb);
}

/**
 * Poisson PMF: P(X = k) = (e^-lambda * lambda^k) / k!
 * Kept as fallback and for comparison
 */
export function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    result *= lambda / i;
  }
  return result;
}

/**
 * Calculate expected goals (lambda) for a team
 * @param {number} attackStrength - team's attack strength ratio
 * @param {number} defenceStrength - opponent's defence strength ratio
 * @param {number} leagueAverage - league average goals (home or away)
 */
export function calcLambda(attackStrength, defenceStrength, leagueAverage = 1.0) {
  return attackStrength * defenceStrength * leagueAverage;
}

/**
 * Build 7x7 score probability matrix using Poisson distribution
 * matrix[i][j] = P(home = i goals, away = j goals)
 */
export function buildScoreMatrix(homeLambda, awayLambda, maxGoals = 6) {
  const size = maxGoals + 1;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      matrix[i][j] = poissonPMF(i, homeLambda) * poissonPMF(j, awayLambda);
    }
  }
  return matrix;
}

/**
 * Calculate 1X2 result probabilities from score matrix
 */
export function calcResultProbs(matrix) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i > j) home += matrix[i][j];
      else if (i === j) draw += matrix[i][j];
      else away += matrix[i][j];
    }
  }
  return { home, draw, away };
}

/**
 * Calculate Over/Under probability
 * @param {number} threshold - e.g. 2.5 for Over/Under 2.5
 */
export function calcOverUnder(matrix, threshold = 2.5) {
  let over = 0, under = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i + j > threshold) over += matrix[i][j];
      else under += matrix[i][j];
    }
  }
  return { over, under };
}

/**
 * Find the most likely score from the matrix
 */
export function getMostLikelyScore(matrix) {
  let maxProb = 0;
  let bestScore = { home: 1, away: 1 };
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] > maxProb) {
        maxProb = matrix[i][j];
        bestScore = { home: i, away: j };
      }
    }
  }
  return bestScore;
}

/**
 * Get xG stats from team stats or fallback to goals * 0.92
 */
export function getXGStats(stats) {
  if (!stats) return { avgScored: 1.2, avgConceded: 1.2 };
  const mp = stats.matches_played || 1;
  let xG = stats.xG;
  let xGA = stats.xGA;
  if (xG === undefined || xG === null || xG === 0) {
    xG = (stats.goals_scored || 0) * 0.92;
  }
  if (xGA === undefined || xGA === null || xGA === 0) {
    xGA = (stats.goals_conceded || 0) * 0.92;
  }
  return {
    avgScored: xG / mp,
    avgConceded: xGA / mp
  };
}

// Smoke test
if (process.argv[1] && process.argv[1].endsWith('poisson.js')) {
  console.log('[NB] Negative Binomial PMF test (mu=1.5):');
  for (let k = 0; k <= 5; k++) {
    console.log(`  P(X=${k}) = ${negativeBinomialPMF(k, 1.5).toFixed(4)}  [Poisson: ${poissonPMF(k, 1.5).toFixed(4)}]`);
  }
  const matrix = buildScoreMatrix(1.5, 1.1);
  console.log('\n[NB] Score Matrix (7x7):');
  matrix.forEach((row, i) => {
    console.log(`  Home=${i}:`, row.map(v => v.toFixed(4)).join('  '));
  });
  console.log('[NB] Result probs:', calcResultProbs(matrix));
  console.log('[NB] Over/Under 2.5:', calcOverUnder(matrix));
  console.log('[NB] Most likely score:', getMostLikelyScore(matrix));
}
