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
 * Build 7x7 score probability matrix using Poisson distribution (independent)
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
 * Bivariate Poisson score matrix — Karlis & Ntzoufrakis (2003)
 *
 * Model: Score1 = X1 + X3, Score2 = X2 + X3
 *   X1 ~ Poisson(λ1), X2 ~ Poisson(λ2), X3 ~ Poisson(λ3)
 * where λ3 is a shared "covariance" component capturing correlation
 * between both teams' scoring (defensive pressure, game state).
 *
 * PMF: P(X=x,Y=y) = e^(-(λ1+λ2+λ3)) * (λ1^x/x!) * (λ2^y/y!)
 *                    * Σ_{k=0}^{min(x,y)} C(x,k)*C(y,k)*k! * (λ3/(λ1*λ2))^k
 *
 * For football: λ3 ≈ 0.10 (Ley, Van de Wiele & Van Eetvelde, 2019)
 *
 * @param {number} homeLambda - expected home goals (E[Score1] = λ1 + λ3)
 * @param {number} awayLambda - expected away goals (E[Score2] = λ2 + λ3)
 * @param {number} lambda3    - covariance parameter (default 0.10)
 * @param {number} maxGoals   - max goals per team in matrix (default 6)
 */
export function buildBivariateScoreMatrix(homeLambda, awayLambda, lambda3 = 0.10, maxGoals = 6) {
  // Decompose: λ1 = homeLambda - λ3, λ2 = awayLambda - λ3
  // Clamp to avoid negatives (minimum 0.01)
  const lambda1 = Math.max(0.01, homeLambda - lambda3);
  const lambda2 = Math.max(0.01, awayLambda - lambda3);
  const l3 = Math.max(0, lambda3);

  const size = maxGoals + 1;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));

  // Precompute log-factorials for speed
  const logFact = [0];
  for (let n = 1; n <= maxGoals; n++) logFact[n] = logFact[n - 1] + Math.log(n);

  // Precompute Poisson log-pmf for lambda1 and lambda2
  // logP1[x] = -lambda1 + x*log(lambda1) - logFact[x]
  const logP1 = Array.from({ length: size }, (_, x) =>
    -lambda1 + (x > 0 ? x * Math.log(lambda1) : 0) - logFact[x]
  );
  const logP2 = Array.from({ length: size }, (_, y) =>
    -lambda2 + (y > 0 ? y * Math.log(lambda2) : 0) - logFact[y]
  );

  const logL3overL1L2 = l3 > 0 ? Math.log(l3) - Math.log(lambda1) - Math.log(lambda2) : -Infinity;
  const expNegL3 = Math.exp(-l3);

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const kMax = Math.min(x, y);
      let sumK = 0;

      for (let k = 0; k <= kMax; k++) {
        // term = C(x,k) * C(y,k) * k! * (λ3/(λ1*λ2))^k
        // log(term) = logC(x,k) + logC(y,k) + logFact[k] + k * log(λ3/(λ1*λ2))
        const logBinomX = logFact[x] - logFact[k] - logFact[x - k];
        const logBinomY = logFact[y] - logFact[k] - logFact[y - k];
        const logTerm = logBinomX + logBinomY + logFact[k] + (k > 0 ? k * logL3overL1L2 : 0);
        sumK += Math.exp(logTerm);
      }

      // P(X=x, Y=y) = e^(-λ3) * poissonPMF(x,λ1) * poissonPMF(y,λ2) * sumK
      matrix[x][y] = expNegL3 * Math.exp(logP1[x] + logP2[y]) * sumK;

      // Guard against NaN/Infinity from numerical edge cases
      if (!isFinite(matrix[x][y]) || isNaN(matrix[x][y])) matrix[x][y] = 0;
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
 * Find the most likely score that is consistent with the favored outcome (Home, Draw, Away)
 * @param {Array} matrix - score matrix
 * @param {object} probs - blended probabilities { home, draw, away }
 */
export function getMostLikelyScoreConsistent(matrix, probs) {
  let maxProb = -1;
  let bestScore = { home: 1, away: 1 };

  const home = probs.home || 0.33;
  const draw = probs.draw || 0.33;
  const away = probs.away || 0.33;

  // Xác định kết quả nào có cơ hội cao nhất
  let favoredType = 'draw';
  if (home > draw && home > away) favoredType = 'home';
  else if (away > home && away > draw) favoredType = 'away';

  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      // Chỉ xét các tỉ số thuộc nhóm kết quả được ưu tiên
      let matchesFavored = false;
      if (favoredType === 'home' && i > j) matchesFavored = true;
      else if (favoredType === 'draw' && i === j) matchesFavored = true;
      else if (favoredType === 'away' && i < j) matchesFavored = true;

      if (matchesFavored && matrix[i][j] > maxProb) {
        maxProb = matrix[i][j];
        bestScore = { home: i, away: j };
      }
    }
  }

  // Fallback phòng trường hợp nhóm ưu tiên không tìm được ô nào
  if (maxProb === -1) {
    return getMostLikelyScore(matrix);
  }

  return bestScore;
}

/**
 * Get xG stats from team stats or fallback to goals * 0.92
 */
export function getXGStats(stats) {
  if (!stats || !stats.matches_played) return { avgScored: 1.2, avgConceded: 1.2 };
  const mp = stats.matches_played;
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
