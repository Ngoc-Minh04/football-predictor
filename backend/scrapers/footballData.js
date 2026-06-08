/**
 * Football-data.org API client (free tier)
 * API docs: https://www.football-data.org/documentation/quickstart
 * Sử dụng shared apiClient với retry + exponential backoff
 */

import { footballDataGet, apiDelay } from '../utils/apiClient.js';
import { queryRun, queryGet, queryAll } from '../db/database.js';
import { processMatchEloUpdate } from '../models/elo.js';

const DELAY_MS = 1000;

/**
 * Fetch all teams in a competition and upsert to DB
 */
export async function fetchAndSaveTeams(db, leagueCode = 'PL') {
  try {
    console.log(`[FootballData] Fetching teams for ${leagueCode}...`);
    const data = await footballDataGet(`/competitions/${leagueCode}/teams`);
    const teams = data.teams || [];

    for (const team of teams) {
      const existing = await queryGet(db, 'SELECT id FROM teams WHERE id = ?', [team.id]);
      if (existing) {
        await queryRun(db,
          'UPDATE teams SET name = ?, league = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [team.name, leagueCode, team.id]
        );
      } else {
        await queryRun(db,
          'INSERT INTO teams (id, name, league) VALUES (?, ?, ?)',
          [team.id, team.name, leagueCode]
        );
      }
    }

    console.log(`[FootballData] Saved ${teams.length} teams for ${leagueCode}`);
    return teams;
  } catch (err) {
    console.error('[FootballData] fetchAndSaveTeams error:', err.message);
    return [];
  }
}

/**
 * Fetch fixtures/results for a season and upsert to DB
 */
export async function fetchAndSaveMatches(db, leagueCode = 'PL', season = 2024) {
  try {
    console.log(`[FootballData] Fetching matches for ${leagueCode} season ${season}...`);
    await apiDelay(DELAY_MS);

    const data = await footballDataGet(`/competitions/${leagueCode}/matches`, { season });
    const matches = data.matches || [];
    let saved = 0;

    for (const match of matches) {
      const homeId = match.homeTeam?.id;
      const awayId = match.awayTeam?.id;
      if (!homeId || !awayId) continue;

      const scoreHome = match.score?.fullTime?.home ?? null;
      const scoreAway = match.score?.fullTime?.away ?? null;
      const date = match.utcDate ? match.utcDate.split('T')[0] : null;
      const status = match.status || 'SCHEDULED';

      const existing = await queryGet(db, 'SELECT id FROM matches WHERE id = ?', [match.id]);
      let matchObj = {
        id: match.id,
        home_team_id: homeId,
        away_team_id: awayId,
        score_home: scoreHome,
        score_away: scoreAway,
        date,
        league: leagueCode
      };

      if (existing) {
        await queryRun(db,
          `UPDATE matches SET score_home = ?, score_away = ?, status = ? WHERE id = ?`,
          [scoreHome, scoreAway, status, match.id]
        );
      } else {
        await queryRun(db,
          `INSERT INTO matches (id, home_team_id, away_team_id, date, score_home, score_away, league, season, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [match.id, homeId, awayId, date, scoreHome, scoreAway, leagueCode, season, status]
        );
      }

      // Automatically trigger live ELO calculation if the match is finished
      if (status === 'FINISHED' && scoreHome !== null && scoreAway !== null) {
        try {
          await processMatchEloUpdate(db, matchObj);
        } catch (eloErr) {
          console.error(`[FootballData] ELO update failed for match ${match.id}:`, eloErr.message);
        }
      }

      saved++;
    }


    console.log(`[FootballData] Saved ${saved} matches for ${leagueCode} ${season}`);
    await rebuildTeamStats(db, leagueCode, season);
    return matches;
  } catch (err) {
    console.error('[FootballData] fetchAndSaveMatches error:', err.message);
    return [];
  }
}


/**
 * Rebuild team_stats from completed match results
 */
async function rebuildTeamStats(db, leagueCode, season) {
  try {
    const teams = await queryAll(db,
      'SELECT id FROM teams WHERE league = ?', [leagueCode]
    );

    for (const team of teams) {
      const matches = await queryAll(db,
        `SELECT * FROM matches
         WHERE (home_team_id = ? OR away_team_id = ?)
         AND league = ? AND season = ? AND status = 'FINISHED'`,
        [team.id, team.id, leagueCode, season]
      );

      let played = 0, scored = 0, conceded = 0;
      for (const m of matches) {
        if (m.score_home === null) continue;
        played++;
        if (m.home_team_id === team.id) {
          scored += m.score_home;
          conceded += m.score_away;
        } else {
          scored += m.score_away;
          conceded += m.score_home;
        }
      }

      await queryRun(db,
        `INSERT INTO team_stats (team_id, season, matches_played, goals_scored, goals_conceded)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(team_id, season) DO UPDATE SET
           matches_played = excluded.matches_played,
           goals_scored = excluded.goals_scored,
           goals_conceded = excluded.goals_conceded`,
        [team.id, season, played, scored, conceded]
      );
    }
    console.log(`[FootballData] Rebuilt team stats for ${leagueCode} ${season}`);
  } catch (err) {
    console.error('[FootballData] rebuildTeamStats error:', err.message);
  }
}

/**
 * Seed sample data if API key is not set
 * Creates fake PL teams so the predictor can run offline
 */
export async function seedSampleData(db) {
  console.log('[FootballData] Seeding sample Premier League data...');
  const sampleTeams = [
    { id: 57, name: 'Arsenal', league: 'PL' },
    { id: 65, name: 'Manchester City', league: 'PL' },
    { id: 66, name: 'Manchester United', league: 'PL' },
    { id: 61, name: 'Chelsea', league: 'PL' },
    { id: 64, name: 'Liverpool', league: 'PL' },
    { id: 73, name: 'Tottenham Hotspur', league: 'PL' },
    { id: 563, name: 'West Ham United', league: 'PL' },
    { id: 397, name: 'Newcastle United', league: 'PL' },
    { id: 340, name: 'Southampton', league: 'PL' },
    { id: 338, name: 'Leicester City', league: 'PL' },
    { id: 354, name: 'Crystal Palace', league: 'PL' },
    { id: 402, name: 'Brentford', league: 'PL' },
    { id: 745, name: 'Brighton & Hove Albion', league: 'PL' },
    { id: 346, name: 'Watford', league: 'PL' },
    { id: 349, name: 'Wolverhampton Wanderers', league: 'PL' },
    { id: 328, name: 'Burnley', league: 'PL' },
    { id: 351, name: 'Nottingham Forest', league: 'PL' },
    { id: 67, name: 'Aston Villa', league: 'PL' },
    { id: 76, name: 'Everton', league: 'PL' },
    { id: 562, name: 'Fulham', league: 'PL' },
  ];

  for (const team of sampleTeams) {
    const existing = await queryGet(db, 'SELECT id FROM teams WHERE id = ?', [team.id]);
    if (!existing) {
      await queryRun(db,
        'INSERT INTO teams (id, name, league, elo_rating) VALUES (?, ?, ?, ?)',
        [team.id, team.name, team.league, 1500 + Math.floor(Math.random() * 200 - 100)]
      );
    }
  }

  // Seed sample stats
  const sampleStats = [
    { id: 57,  gs: 42, gc: 24, mp: 25, xG: 44, xGA: 23 },  // Arsenal
    { id: 65,  gs: 55, gc: 20, mp: 25, xG: 57, xGA: 18 },  // Man City
    { id: 66,  gs: 25, gc: 40, mp: 25, xG: 28, xGA: 38 },  // Man United
    { id: 61,  gs: 35, gc: 30, mp: 25, xG: 37, xGA: 31 },  // Chelsea
    { id: 64,  gs: 50, gc: 22, mp: 25, xG: 52, xGA: 21 },  // Liverpool
    { id: 73,  gs: 38, gc: 33, mp: 25, xG: 40, xGA: 32 },  // Tottenham
    { id: 563, gs: 30, gc: 38, mp: 25, xG: 32, xGA: 37 },  // West Ham
    { id: 397, gs: 40, gc: 28, mp: 25, xG: 41, xGA: 27 },  // Newcastle
    { id: 340, gs: 20, gc: 45, mp: 25, xG: 22, xGA: 44 },  // Southampton
    { id: 338, gs: 22, gc: 42, mp: 25, xG: 24, xGA: 40 },  // Leicester
    { id: 354, gs: 28, gc: 35, mp: 25, xG: 30, xGA: 34 },  // Crystal Palace
    { id: 402, gs: 32, gc: 33, mp: 25, xG: 33, xGA: 32 },  // Brentford
    { id: 745, gs: 36, gc: 30, mp: 25, xG: 37, xGA: 29 },  // Brighton
    { id: 346, gs: 18, gc: 48, mp: 25, xG: 20, xGA: 46 },  // Watford
    { id: 349, gs: 29, gc: 35, mp: 25, xG: 31, xGA: 34 },  // Wolves
    { id: 328, gs: 16, gc: 50, mp: 25, xG: 18, xGA: 48 },  // Burnley
    { id: 351, gs: 33, gc: 32, mp: 25, xG: 35, xGA: 31 },  // Nottingham
    { id: 67,  gs: 45, gc: 26, mp: 25, xG: 47, xGA: 25 },  // Aston Villa
    { id: 76,  gs: 24, gc: 40, mp: 25, xG: 26, xGA: 39 },  // Everton
    { id: 562, gs: 31, gc: 34, mp: 25, xG: 33, xGA: 33 },  // Fulham
  ];

  for (const s of sampleStats) {
    await queryRun(db,
      `INSERT INTO team_stats (team_id, season, matches_played, goals_scored, goals_conceded, xG, xGA)
       VALUES (?, 2024, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, season) DO UPDATE SET
         matches_played = excluded.matches_played,
         goals_scored = excluded.goals_scored,
         goals_conceded = excluded.goals_conceded,
         xG = excluded.xG,
         xGA = excluded.xGA`,
      [s.id, s.mp, s.gs, s.gc, s.xG, s.xGA]
    );
  }

  console.log('[FootballData] Sample data seeded successfully.');
}
