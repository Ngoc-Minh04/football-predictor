/**
 * Poisson Distribution Model
 * Calculates goal probability distributions for match prediction
 */

/**
 * Poisson PMF: P(X = k) = (e^-lambda * lambda^k) / k!
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
 * Build 7x7 score probability matrix
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
  const matrix = buildScoreMatrix(1.5, 1.1);
  console.log('[Poisson] Score Matrix (7x7):');
  matrix.forEach((row, i) => {
    console.log(`  Home=${i}:`, row.map(v => v.toFixed(4)).join('  '));
  });
  console.log('[Poisson] Result probs:', calcResultProbs(matrix));
  console.log('[Poisson] Over/Under 2.5:', calcOverUnder(matrix));
  console.log('[Poisson] Most likely score:', getMostLikelyScore(matrix));
}
