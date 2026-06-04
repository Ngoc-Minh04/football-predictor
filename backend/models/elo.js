/**
 * ELO Rating System
 * Tracks team strength over time using the Elo rating algorithm
 */

const DEFAULT_ELO = 1500;

/**
 * Calculate win expectancy for team A vs team B
 * Returns probability of team A winning
 */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ELO ratings after a match
 * @param {number} ratingHome - ELO rating of home team
 * @param {number} ratingAway - ELO rating of away team
 * @param {string} result - 'home', 'draw', or 'away'
 * @param {number} kFactor - K-factor (20 for league, 30 for knockouts)
 * @returns {{ newHome: number, newAway: number }}
 */
export function updateElo(ratingHome, ratingAway, result, kFactor = 20) {
  const expectedHome = expectedScore(ratingHome, ratingAway);
  const expectedAway = 1 - expectedHome;

  let actualHome, actualAway;
  if (result === 'home') {
    actualHome = 1;
    actualAway = 0;
  } else if (result === 'draw') {
    actualHome = 0.5;
    actualAway = 0.5;
  } else {
    actualHome = 0;
    actualAway = 1;
  }

  const newHome = ratingHome + kFactor * (actualHome - expectedHome);
  const newAway = ratingAway + kFactor * (actualAway - expectedAway);

  return {
    newHome: Math.round(newHome * 100) / 100,
    newAway: Math.round(newAway * 100) / 100,
  };
}

/**
 * Get the current ELO rating for a team from DB
 * @param {object} db - sqlite3 database connection
 * @param {number} teamId
 * @returns {Promise<number>}
 */
export async function getTeamElo(db, teamId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT elo_rating FROM teams WHERE id = ?', [teamId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.elo_rating : DEFAULT_ELO);
    });
  });
}

/**
 * Save ELO history record after a match
 */
export async function saveEloHistory(db, teamId, matchId, eloBefore, eloAfter, date) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO elo_history (team_id, match_id, elo_before, elo_after, date)
       VALUES (?, ?, ?, ?, ?)`,
      [teamId, matchId, eloBefore, eloAfter, date],
      function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID });
      }
    );
  });
}

/**
 * Update team ELO rating in DB
 */
export async function updateTeamElo(db, teamId, newElo) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE teams SET elo_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newElo, teamId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Convert ELO rating difference to win probability boost
 * Used to blend ELO adjustments into Poisson-based predictions
 */
export function eloToProbabilityAdjustment(homeElo, awayElo) {
  const homeWinProb = expectedScore(homeElo, awayElo);
  return homeWinProb; // 0.0 – 1.0 (0.5 = equal teams)
}
