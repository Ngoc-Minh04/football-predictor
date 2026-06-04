/**
 * Understat.com scraper — xG (Expected Goals) data
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { getDatabase, queryRun, queryGet } from '../db/database.js';

const DELAY_MS = 3000; // 3 seconds delay between requests to avoid being blocked

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * League codes mapping (understat URL slugs)
 */
const LEAGUE_MAP = {
  PL: 'EPL',
  PD: 'La_liga',
  BL1: 'Bundesliga',
  SA: 'Serie_A',
  FL1: 'Ligue_1',
};

/**
 * Fetch xG data for all teams in a league/season from understat.com
 */
export async function fetchXGData(leagueCode = 'PL', season = 2024) {
  const leagueSlug = LEAGUE_MAP[leagueCode];
  if (!leagueSlug) {
    console.warn(`[Understat] Unknown league code: ${leagueCode}`);
    return null;
  }

  // Understat now loads data dynamically via AJAX
  const url = `https://understat.com/getLeagueData/${leagueSlug}/${season}`;
  console.log(`[Understat] Fetching xG data from: ${url}`);

  try {
    const res = await axios.get(url, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    if (res.data && res.data.teams) {
      console.log(`[Understat] Extracted xG data for ${Object.keys(res.data.teams).length} teams`);
      return res.data.teams;
    }

    console.warn('[Understat] Could not extract teams data from response');
    return null;
  } catch (err) {
    console.error(`[Understat] fetchXGData error: ${err.message}`);
    return null;
  }
}

/**
 * Save xG/xGA stats from understat to team_stats table
 */
export async function saveXGToDb(db, teamsData, season = 2024) {
  if (!teamsData) return;

  const TEAM_NAME_MAPPING = {
    "Manchester City": "Manchester City FC",
    "Manchester United": "Manchester United FC",
    "Newcastle United": "Newcastle United FC",
    "Tottenham": "Tottenham Hotspur FC",
    "Leicester": "Leicester City FC",
    "Ipswich": "Ipswich Town FC",
    "Nottingham Forest": "Nottingham Forest FC",
    "Crystal Palace": "Crystal Palace FC",
    "Brentford": "Brentford FC",
    "West Ham": "West Ham United FC",
    "Bournemouth": "AFC Bournemouth",
    "Brighton": "Brighton & Hove Albion FC",
    "Wolverhampton Wanderers": "Wolverhampton Wanderers FC",
    "Aston Villa": "Aston Villa FC",
    "Arsenal": "Arsenal FC",
    "Chelsea": "Chelsea FC",
    "Everton": "Everton FC",
    "Fulham": "Fulham FC",
    "Liverpool": "Liverpool FC",
    "Southampton": "Southampton FC"
  };

  for (const [, teamInfo] of Object.entries(teamsData)) {
    const teamTitle = teamInfo.title;

    let xG = 0;
    let xGA = 0;
    let matchesPlayed = 0;
    let goalsScored = 0;
    let goalsConceded = 0;

    if (teamInfo.history && Array.isArray(teamInfo.history)) {
      matchesPlayed = teamInfo.history.length;
      xG = teamInfo.history.reduce((sum, m) => sum + (parseFloat(m.xG) || 0), 0);
      xGA = teamInfo.history.reduce((sum, m) => sum + (parseFloat(m.xGA) || 0), 0);
      goalsScored = teamInfo.history.reduce((sum, m) => sum + (parseInt(m.scored) || 0), 0);
      goalsConceded = teamInfo.history.reduce((sum, m) => sum + (parseInt(m.missed) || 0), 0);
    } else {
      xG = parseFloat(teamInfo.xG) || 0;
      xGA = parseFloat(teamInfo.xGA) || 0;
    }

    const mappedName = TEAM_NAME_MAPPING[teamTitle] || teamTitle;

    let team = await queryGet(db, "SELECT id, name FROM teams WHERE name = ?", [mappedName]);
    if (!team) {
      team = await queryGet(db, "SELECT id, name FROM teams WHERE name LIKE ?", [`%${teamTitle.split(' ')[0]}%`]);
    }

    if (team) {
      const existing = await queryGet(db,
        "SELECT team_id FROM team_stats WHERE team_id = ? AND season = ?",
        [team.id, season]
      );

      if (existing) {
        await queryRun(db,
          `UPDATE team_stats
           SET xG = ?, xGA = ?, matches_played = ?, goals_scored = ?, goals_conceded = ?
           WHERE team_id = ? AND season = ?`,
          [xG, xGA, matchesPlayed || 38, goalsScored, goalsConceded, team.id, season]
        );
        console.log(`[Understat] Updated xG for ${team.name} (from ${teamTitle}): xG=${xG.toFixed(2)}, xGA=${xGA.toFixed(2)}`);
      } else {
        await queryRun(db,
          `INSERT INTO team_stats (team_id, season, matches_played, goals_scored, goals_conceded, xG, xGA)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [team.id, season, matchesPlayed || 38, goalsScored, goalsConceded, xG, xGA]
        );
        console.log(`[Understat] Inserted xG for ${team.name} (from ${teamTitle}): xG=${xG.toFixed(2)}, xGA=${xGA.toFixed(2)}`);
      }

      // Save match-by-match xG into matches table
      if (teamInfo.history && Array.isArray(teamInfo.history)) {
        let matchUpdates = 0;
        for (const hm of teamInfo.history) {
          if (!hm.date) continue;
          const matchDatePart = hm.date.split(' ')[0];
          
          if (hm.h_a === 'h') {
            const result = await queryRun(db,
              `UPDATE matches 
               SET xg_home = ?, xg_away = ? 
               WHERE home_team_id = ? AND date = ? AND season = ?`,
              [parseFloat(hm.xG), parseFloat(hm.xGA), team.id, matchDatePart, season]
            );
            if (result.changes > 0) matchUpdates++;
          } else {
            const result = await queryRun(db,
              `UPDATE matches 
               SET xg_home = ?, xg_away = ? 
               WHERE away_team_id = ? AND date = ? AND season = ?`,
              [parseFloat(hm.xGA), parseFloat(hm.xG), team.id, matchDatePart, season]
            );
            if (result.changes > 0) matchUpdates++;
          }
        }
        console.log(`[Understat] Updated match-by-match xG for ${team.name}: ${matchUpdates} matches.`);
      }
    } else {
      console.warn(`[Understat] Could not find team in DB for understat team: ${teamTitle}`);
    }
  }
}

// Self-run entry point
async function main() {
  const db = await getDatabase();
  const seasons = [2024, 2025];
  const leagues = ['PL']; // PL is EPL

  for (const season of seasons) {
    for (const league of leagues) {
      console.log(`\n[Scraper] Starting scrape for league=${league}, season=${season}...`);
      const data = await fetchXGData(league, season);
      if (data) {
        await saveXGToDb(db, data, season);
      }
      console.log(`[Scraper] Finished league=${league}, season=${season}. Waiting ${DELAY_MS / 1000}s...`);
      await sleep(DELAY_MS);
    }
  }
  console.log('\n[Scraper] Scraping completed.');
}

// Only execute main if run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('understat.js') || 
  process.argv[1].endsWith('understat')
);

if (isDirectRun) {
  main().catch(err => {
    console.error('Scraper failed:', err);
    process.exit(1);
  });
}
