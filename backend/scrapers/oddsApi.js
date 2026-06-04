import axios from 'axios';
import dotenv from 'dotenv';
import { getDatabase, queryGet, queryRun } from '../db/database.js';

dotenv.config();

const TEAM_NAME_MAPPING = {
  "Manchester City": "Manchester City FC",
  "Manchester United": "Manchester United FC",
  "Newcastle United": "Newcastle United FC",
  "Tottenham Hotspur": "Tottenham Hotspur FC",
  "Tottenham": "Tottenham Hotspur FC",
  "Leicester City": "Leicester City FC",
  "Leicester": "Leicester City FC",
  "Ipswich Town": "Ipswich Town FC",
  "Ipswich": "Ipswich Town FC",
  "Nottingham Forest": "Nottingham Forest FC",
  "Crystal Palace": "Crystal Palace FC",
  "Brentford": "Brentford FC",
  "West Ham United": "West Ham United FC",
  "West Ham": "West Ham United FC",
  "Bournemouth": "AFC Bournemouth",
  "Brighton and Hove Albion": "Brighton & Hove Albion FC",
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

const SPORT_KEY_MAPPING = {
  'PL':  'soccer_epl',          // English Premier League
  'PD':  'soccer_spain_la_liga', // La Liga
  'BL1': 'soccer_germany_bundesliga', // Bundesliga
  'SA':  'soccer_italy_serie_a', // Serie A
  'FL1': 'soccer_france_ligue_one', // Ligue 1
  'WC':  'soccer_fifa_world_cup', // FIFA World Cup
  'CL':  'soccer_uefa_champs_league', // Champions League
};

/**
 * Fetch odds and save to DB
 * @param {string} league - league code (default: 'PL' = EPL)
 */
export async function fetchAndStoreOdds(league = 'PL') {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    console.warn('[Odds] ODDS_API_KEY is not configured in .env. Skipping API fetch.');
    return;
  }

  const db = await getDatabase();
  const sportKey = SPORT_KEY_MAPPING[league] || 'soccer_epl';
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`;

  console.log(`[Odds] Fetching odds from: ${url} (league=${league})`);

  try {
    const res = await axios.get(url, {
      params: {
        apiKey,
        regions: 'eu',
        markets: 'h2h,totals',
        oddsFormat: 'decimal'
      },
      timeout: 15000
    });

    const matchesData = res.data;
    if (!Array.isArray(matchesData)) {
      console.warn('[Odds] API did not return a valid array of matches.');
      return;
    }

    console.log(`[Odds] Received ${matchesData.length} matches from Odds API.`);

    for (const match of matchesData) {
      const matchDate = match.commence_time.split('T')[0];
      const mappedHome = TEAM_NAME_MAPPING[match.home_team] || match.home_team;
      const mappedAway = TEAM_NAME_MAPPING[match.away_team] || match.away_team;

      // Find database match
      let dbMatch = await queryGet(db,
        `SELECT m.id 
         FROM matches m
         JOIN teams ht ON m.home_team_id = ht.id
         JOIN teams at ON m.away_team_id = at.id
         WHERE (ht.name = ? OR ht.name LIKE ?) 
           AND (at.name = ? OR at.name LIKE ?) 
           AND m.date = ?`,
        [mappedHome, `%${match.home_team.split(' ')[0]}%`, mappedAway, `%${match.away_team.split(' ')[0]}%`, matchDate]
      );

      if (!dbMatch) {
        // Fallback: match without date constraint (scheduled matches close to date)
        dbMatch = await queryGet(db,
          `SELECT m.id 
           FROM matches m
           JOIN teams ht ON m.home_team_id = ht.id
           JOIN teams at ON m.away_team_id = at.id
           WHERE (ht.name = ? OR ht.name LIKE ?) 
             AND (at.name = ? OR at.name LIKE ?) 
             AND m.status = 'SCHEDULED'`,
          [mappedHome, `%${match.home_team.split(' ')[0]}%`, mappedAway, `%${match.away_team.split(' ')[0]}%`]
        );
      }

      if (!dbMatch) {
        continue;
      }

      // Calculate fair odds probabilities across bookmakers
      let totalH2HCount = 0;
      let sumHomeProb = 0;
      let sumDrawProb = 0;
      let sumAwayProb = 0;

      let totalTotalsCount = 0;
      let sumOverProb = 0;
      let sumUnderProb = 0;

      if (match.bookmakers && Array.isArray(match.bookmakers)) {
        for (const bookmaker of match.bookmakers) {
          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (h2hMarket) {
            const homeOutcome = h2hMarket.outcomes.find(o => o.name === match.home_team);
            const awayOutcome = h2hMarket.outcomes.find(o => o.name === match.away_team);
            const drawOutcome = h2hMarket.outcomes.find(o => o.name === 'Draw');
            if (homeOutcome && awayOutcome && drawOutcome) {
              const oddHome = parseFloat(homeOutcome.price);
              const oddAway = parseFloat(awayOutcome.price);
              const oddDraw = parseFloat(drawOutcome.price);
              const pHome = 1 / oddHome;
              const pAway = 1 / oddAway;
              const pDraw = 1 / oddDraw;
              const overround = pHome + pDraw + pAway;
              sumHomeProb += pHome / overround;
              sumDrawProb += pDraw / overround;
              sumAwayProb += pAway / overround;
              totalH2HCount++;
            }
          }

          const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');
          if (totalsMarket) {
            const overOutcome = totalsMarket.outcomes.find(o => o.name === 'Over' && o.point === 2.5);
            const underOutcome = totalsMarket.outcomes.find(o => o.name === 'Under' && o.point === 2.5);
            if (overOutcome && underOutcome) {
              const oddOver = parseFloat(overOutcome.price);
              const oddUnder = parseFloat(underOutcome.price);
              const pOver = 1 / oddOver;
              const pUnder = 1 / oddUnder;
              const overround = pOver + pUnder;
              sumOverProb += pOver / overround;
              sumUnderProb += pUnder / overround;
              totalTotalsCount++;
            }
          }
        }
      }

      if (totalH2HCount > 0) {
        const avgHome = sumHomeProb / totalH2HCount;
        const avgDraw = sumDrawProb / totalH2HCount;
        const avgAway = sumAwayProb / totalH2HCount;
        const avgOver = totalTotalsCount > 0 ? (sumOverProb / totalTotalsCount) : 0.5;
        const avgUnder = totalTotalsCount > 0 ? (sumUnderProb / totalTotalsCount) : 0.5;

        await queryRun(db,
          `INSERT INTO odds_cache (match_id, home_prob, draw_prob, away_prob, over25_prob, under25_prob, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(match_id) DO UPDATE SET
             home_prob = excluded.home_prob,
             draw_prob = excluded.draw_prob,
             away_prob = excluded.away_prob,
             over25_prob = excluded.over25_prob,
             under25_prob = excluded.under25_prob,
             fetched_at = CURRENT_TIMESTAMP`,
          [dbMatch.id, avgHome, avgDraw, avgAway, avgOver, avgUnder]
        );
        console.log(`[Odds] Saved odds for ${match.home_team} vs ${match.away_team} (Match ID: ${dbMatch.id})`);
      }
    }
  } catch (err) {
    console.error(`[Odds] Error fetching/storing odds: ${err.message}`);
  }
}

/**
 * Blend Poisson probabilities with bookmaker implied probabilities
 * Upgrade 4: Dynamic blend weight based on model confidence:
 *   confidence >= 0.65 → 70% model, 30% bookmaker (trust model more)
 *   confidence <  0.45 → 35% model, 65% bookmaker (trust bookmaker more)
 *   otherwise          → 55% model, 45% bookmaker (default)
 * @param {object} poissonResult
 * @param {object} poissonOU
 * @param {number} matchId
 * @param {object} db
 * @param {number} confidence - model confidence score (0-1), optional
 */
export async function blendWithBookmaker(poissonResult, poissonOU, matchId, db, confidence = 0.55) {
  const database = db || await getDatabase();

  // Upgrade 4: Calculate dynamic model weight
  let modelWeight;
  if (confidence >= 0.65) {
    modelWeight = 0.70; // High confidence: trust model
  } else if (confidence < 0.45) {
    modelWeight = 0.35; // Low confidence: trust bookmaker
  } else {
    modelWeight = 0.55; // Mid confidence: balanced
  }
  const bookWeight = 1 - modelWeight;

  try {
    // Check cache within 6 hours
    const odds = await queryGet(database,
      `SELECT * FROM odds_cache 
       WHERE match_id = ? AND datetime(fetched_at, '+6 hours') >= datetime('now')`,
      [matchId]
    );

    if (odds) {
      const blendedResult = {
        home: modelWeight * poissonResult.home + bookWeight * odds.home_prob,
        draw: modelWeight * poissonResult.draw + bookWeight * odds.draw_prob,
        away: modelWeight * poissonResult.away + bookWeight * odds.away_prob
      };

      const blendedOU = {
        over25: modelWeight * poissonOU.over25 + bookWeight * odds.over25_prob,
        under25: modelWeight * poissonOU.under25 + bookWeight * odds.under25_prob,
        prediction: (modelWeight * poissonOU.over25 + bookWeight * odds.over25_prob) > 0.5 ? 'Tài' : 'Xỉu'
      };

      return { result: blendedResult, overUnder: blendedOU, blended: true, modelWeight };
    }
  } catch (e) {
    console.error('[Odds] blendWithBookmaker error:', e.message);
  }
  return { result: poissonResult, overUnder: poissonOU, blended: false, modelWeight };
}

// Self-run entry point
async function main() {
  await fetchAndStoreOdds();
  process.exit(0);
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('oddsApi.js') || 
  process.argv[1].endsWith('oddsApi')
);

if (isDirectRun) {
  main().catch(err => {
    console.error('Odds fetcher failed:', err);
    process.exit(1);
  });
}
