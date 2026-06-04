/**
 * Bayesian Real-time Probability Updater
 * Updates match outcome probabilities as events occur during a match
 */

/**
 * Apply a goal event to current probabilities using Bayesian update
 * When the home team scores, P(home win) increases, P(away win) decreases
 * 
 * @param {object} probs - current { home, draw, away } probabilities
 * @param {'home'|'away'} scoringTeam - which team scored
 * @param {number} minute - match minute (1–90+)
 * @param {object} currentScore - { home, away } current score
 */
export function applyGoal(probs, scoringTeam, minute, currentScore) {
  // Time remaining factor: late goals have larger impact
  const timeRemaining = Math.max(90 - minute, 1);
  const timeFactor = 1 + (90 - timeRemaining) / 90; // 1.0 early → 2.0 at 90'

  let { home, draw, away } = probs;

  if (scoringTeam === 'home') {
    // Home scores — home win becomes more likely
    const boost = 0.15 * timeFactor;
    home = Math.min(0.97, home + boost);
    away = Math.max(0.01, away - boost * 0.7);
    draw = Math.max(0.01, draw - boost * 0.3);
  } else {
    // Away scores — away win becomes more likely
    const boost = 0.15 * timeFactor;
    away = Math.min(0.97, away + boost);
    home = Math.max(0.01, home - boost * 0.7);
    draw = Math.max(0.01, draw - boost * 0.3);
  }

  // Normalize so they sum to 1
  const total = home + draw + away;
  return {
    home: Math.round((home / total) * 100) / 100,
    draw: Math.round((draw / total) * 100) / 100,
    away: Math.round((away / total) * 100) / 100,
  };
}

/**
 * Apply a red card event — reduces the affected team's probabilities
 * @param {object} probs - current probabilities
 * @param {'home'|'away'} team - team that received the red card
 */
export function applyRedCard(probs, team) {
  let { home, draw, away } = probs;

  if (team === 'home') {
    // Home team down to 10 men — penalise home win prob significantly
    const penalty = home * 0.35;
    home -= penalty;
    away += penalty * 0.7;
    draw += penalty * 0.3;
  } else {
    // Away team down to 10 men
    const penalty = away * 0.35;
    away -= penalty;
    home += penalty * 0.7;
    draw += penalty * 0.3;
  }

  const total = home + draw + away;
  return {
    home: Math.round((home / total) * 100) / 100,
    draw: Math.round((draw / total) * 100) / 100,
    away: Math.round((away / total) * 100) / 100,
  };
}

/**
 * Apply time progression — as the match progresses with no change, draw probability shifts
 * @param {object} probs - current probabilities
 * @param {number} minute - current match minute
 * @param {object} currentScore - { home, away } current goals
 */
export function applyTimeElapsed(probs, minute, currentScore) {
  const { home: homeGoals, away: awayGoals } = currentScore;
  let { home, draw, away } = probs;

  if (minute < 60) return { home, draw, away }; // Only update in final third

  // As it gets late and teams are drawing, draw probability solidifies
  const lateGameFactor = (minute - 60) / 30; // 0 at 60', 1 at 90'

  if (homeGoals === awayGoals) {
    // Current draw — draw probability drifts upward
    const drawBoost = 0.08 * lateGameFactor;
    draw = Math.min(0.7, draw + drawBoost);
    home -= drawBoost * 0.5;
    away -= drawBoost * 0.5;
  } else if (homeGoals > awayGoals) {
    // Home winning — home win solidifies
    const boost = 0.05 * lateGameFactor;
    home = Math.min(0.95, home + boost);
    draw -= boost * 0.5;
    away -= boost * 0.5;
  } else {
    // Away winning
    const boost = 0.05 * lateGameFactor;
    away = Math.min(0.95, away + boost);
    draw -= boost * 0.5;
    home -= boost * 0.5;
  }

  const total = Math.max(home + draw + away, 0.01);
  return {
    home: Math.round(Math.max(0.01, home / total) * 100) / 100,
    draw: Math.round(Math.max(0.01, draw / total) * 100) / 100,
    away: Math.round(Math.max(0.01, away / total) * 100) / 100,
  };
}

/**
 * Master update function — applies all events in order
 * @param {object} priorProbs - pre-match probabilities { home, draw, away }
 * @param {object} matchState - { minute, score: { home, away }, events: [{ type, team, minute }] }
 */
export function updateProbabilities(priorProbs, matchState) {
  const { minute, score, events = [] } = matchState;
  let probs = { ...priorProbs };

  // Replay all events in chronological order
  const sorted = [...events].sort((a, b) => a.minute - b.minute);
  for (const event of sorted) {
    if (event.type === 'goal') {
      probs = applyGoal(probs, event.team, event.minute, score);
    } else if (event.type === 'red_card') {
      probs = applyRedCard(probs, event.team);
    }
  }

  // Apply current time
  probs = applyTimeElapsed(probs, minute, score);

  return probs;
}
