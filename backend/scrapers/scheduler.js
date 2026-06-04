/**
 * Scheduler — Cron jobs to auto-refresh data
 */

import cron from 'node-cron';
import { getDatabase } from '../db/database.js';
import { fetchAndSaveTeams, fetchAndSaveMatches } from './footballData.js';
import { fetchXGData, saveXGToDb } from './understat.js';
import { fetchAndStoreOdds } from './oddsApi.js';

const LEAGUE = process.env.DEFAULT_LEAGUE || 'PL';
const SEASON = parseInt(process.env.DEFAULT_SEASON || '2024');

/**
 * Full data refresh: teams + matches + xG
 */
async function fullRefresh() {
  console.log(`[Scheduler] Starting full data refresh for ${LEAGUE} ${SEASON}...`);
  const db = await getDatabase();
  
  try {
    await fetchAndSaveTeams(db, LEAGUE);
    await fetchAndSaveMatches(db, LEAGUE, SEASON);

    const xgData = await fetchXGData(LEAGUE, SEASON);
    if (xgData) {
      await saveXGToDb(db, xgData, SEASON);
    }
    console.log('[Scheduler] Full refresh completed.');
  } catch (err) {
    console.error('[Scheduler] Refresh error:', err.message);
  }
}

/**
 * Initialize and start all cron jobs
 */
export function startScheduler() {
  // Daily 3am: full refresh
  cron.schedule('0 3 * * *', () => {
    console.log('[Scheduler] Running daily full refresh...');
    fullRefresh();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // Every 3 hours: update match scores
  cron.schedule('0 */3 * * *', async () => {
    console.log('[Scheduler] Running match score update...');
    const db = await getDatabase();
    fetchAndSaveMatches(db, LEAGUE, SEASON).catch(err =>
      console.error('[Scheduler] Match update error:', err.message)
    );
  });

  // Every 6 hours: fetch betting odds
  cron.schedule('0 */6 * * *', () => {
    console.log('[Scheduler] Running odds update...');
    fetchAndStoreOdds().catch(err =>
      console.error('[Scheduler] Odds update error:', err.message)
    );
  });

  console.log('[Scheduler] Cron jobs started: daily 3am full refresh + every 3h match update + every 6h odds update');
}

export { fullRefresh };
