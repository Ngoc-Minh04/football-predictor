/**
 * Dixon-Coles Correction Model
 * Corrects for under-representation of low-scoring matches in Poisson model
 * 
 * Reference: Dixon & Coles (1997) "Modelling Association Football Scores and Inefficiencies in the Football Betting Market"
 */

const DEFAULT_RHO = -0.13;

/**
 * Tau correction factor for low-score cells
 * Adjusts P(0-0), P(1-0), P(0-1), P(1-1) to better match real data
 * @param {number} x - home goals
 * @param {number} y - away goals
 * @param {number} muHome - home expected goals (lambda)
 * @param {number} muAway - away expected goals (lambda)
 * @param {number} rho - correction strength, typically -0.13
 */
export function tauCorrection(x, y, muHome, muAway, rho = DEFAULT_RHO) {
  if (x === 0 && y === 0) return 1 - muHome * muAway * rho;
  if (x === 1 && y === 0) return 1 + muAway * rho;
  if (x === 0 && y === 1) return 1 + muHome * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Apply Dixon-Coles correction to the score probability matrix
 * Mutates low-score cells (0-0, 1-0, 0-1, 1-1) in place
 * @param {number[][]} matrix - 7x7 score probability matrix
 * @param {number} muHome - home expected goals
 * @param {number} muAway - away expected goals
 * @param {number} rho - correction factor
 */
export function applyDixonColes(matrix, muHome, muAway, rho = DEFAULT_RHO) {
  const correctedMatrix = matrix.map(row => [...row]);

  // Only apply to low-scoring cells: 0-0, 1-0, 0-1, 1-1
  const lowScoreCells = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (const [i, j] of lowScoreCells) {
    if (i < correctedMatrix.length && j < correctedMatrix[i].length) {
      correctedMatrix[i][j] *= tauCorrection(i, j, muHome, muAway, rho);
    }
  }

  return correctedMatrix;
}
