/**
 * seedHistorical.js — Pull lịch sử trận đấu từ football-data.org
 * Hỗ trợ nhiều giải: PL (Ngoại Hạng Anh), WC (World Cup), CL (Champions League), v.v.
 *
 * Chạy:
 *   npm run seed              → seed EPL (PL) mặc định
 *   node scrapers/seedHistorical.js WC    → seed World Cup
 *   node scrapers/seedHistorical.js CL    → seed Champions League
 *
 * Giới hạn free tier: 10 requests/phút → delay 6s giữa mỗi request
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { initDatabase } from '../db/init.js';
import { queryRun, queryGet, queryAll } from '../db/database.js';

const BASE_URL = 'https://api.football-data.org/v4';
const DELAY_MS = 6000;
const CURRENT_YEAR = new Date().getFullYear();

// ─── League configurations ─────────────────────────────────────────────────────
const LEAGUE_CONFIG = {
  'PL':  { name: 'Ngoại Hạng Anh (EPL)', seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
  'WC':  { name: 'FIFA World Cup',        seasons: [2022, 2026],                          isNeutral: true  }, // World Cup đá sân trung lập
  'EC':  { name: 'UEFA Euro',             seasons: [2024],                                isNeutral: true  }, // Euro đá sân trung lập
  'CL':  { name: 'UEFA Champions League', seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
  'PD':  { name: 'La Liga (Tây Ban Nha)', seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
  'BL1': { name: 'Bundesliga (Đức)',      seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
  'SA':  { name: 'Serie A (Ý)',           seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
  'FL1': { name: 'Ligue 1 (Pháp)',       seasons: [CURRENT_YEAR - 1, CURRENT_YEAR - 2], isNeutral: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeaders() {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key || key === 'your_football_data_key_here') {
    console.error('[Seed] ❌ FOOTBALL_DATA_API_KEY chưa được cấu hình trong file .env');
    console.error('[Seed]    Đăng ký tại: https://www.football-data.org/client/register');
    process.exit(1);
  }
  return { 'X-Auth-Token': key };
}

/**
 * Retry logic với exponential backoff
 * Thử lại tối đa 3 lần: wait 6s → 12s → 24s
 */
async function fetchWithRetry(url, retries = 3, baseDelay = DELAY_MS) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      if (attempt === retries) {
        throw new Error(`[Seed] Thất bại sau ${retries} lần thử: ${err.message}`);
      }

      const waitMs = baseDelay * Math.pow(2, attempt - 1); // 6s, 12s, 24s
      console.warn(`[Seed] Lần ${attempt} thất bại (${status || err.code}) — thử lại sau ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

async function upsertTeam(db, team, league) {
  const existing = await queryGet(db, 'SELECT id, league FROM teams WHERE id = ?', [team.id]);
  if (existing) {
    let newLeague = existing.league;
    const currentLeagues = existing.league ? existing.league.split(',') : [];
    if (!currentLeagues.includes(league)) {
      currentLeagues.push(league);
      newLeague = currentLeagues.join(',');
    }
    await queryRun(db,
      'UPDATE teams SET name = ?, league = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [team.name, newLeague, team.id]
    );
  } else {
    await queryRun(db,
      'INSERT OR IGNORE INTO teams (id, name, league, elo_rating) VALUES (?, ?, ?, 1500)',
      [team.id, team.name, league]
    );
  }
}

async function upsertMatch(db, match, league, season) {
  const homeId = match.homeTeam?.id;
  const awayId = match.awayTeam?.id;
  if (!homeId || !awayId) return false;

  const scoreHome = match.score?.fullTime?.home ?? null;
  const scoreAway = match.score?.fullTime?.away ?? null;
  const date = match.utcDate ? match.utcDate.split('T')[0] : null;
  const status = match.status || 'SCHEDULED';

  const existing = await queryGet(db, 'SELECT id FROM matches WHERE id = ?', [match.id]);
  if (existing) {
    await queryRun(db,
      `UPDATE matches SET score_home = ?, score_away = ?, status = ? WHERE id = ?`,
      [scoreHome, scoreAway, status, match.id]
    );
  } else {
    await queryRun(db,
      `INSERT OR IGNORE INTO matches
         (id, home_team_id, away_team_id, date, score_home, score_away, league, season, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [match.id, homeId, awayId, date, scoreHome, scoreAway, league, season, status]
    );
  }
  return true;
}

// ─── Rebuild team_stats từ match results ─────────────────────────────────────

async function rebuildTeamStats(db, league, season) {
  console.log(`\n[Seed] Tính toán lại team_stats cho ${league} ${season}...`);

  const teams = await queryAll(db,
    'SELECT id, name FROM teams WHERE league = ?', [league]
  );

  for (const team of teams) {
    const matches = await queryAll(db,
      `SELECT * FROM matches
       WHERE (home_team_id = ? OR away_team_id = ?)
         AND league = ? AND season = ? AND status = 'FINISHED'
         AND score_home IS NOT NULL`,
      [team.id, team.id, league, season]
    );

    let played = 0, scored = 0, conceded = 0, wins = 0, draws = 0, losses = 0;

    for (const m of matches) {
      played++;
      const isHome = m.home_team_id === team.id;
      const gf = isHome ? m.score_home : m.score_away;
      const ga = isHome ? m.score_away : m.score_home;
      scored += gf;
      conceded += ga;
      if (gf > ga) wins++;
      else if (gf === ga) draws++;
      else losses++;
    }

    // Ước tính xG từ số bàn thực tế
    const xG  = Math.round(scored  * 0.92 * 10) / 10;
    const xGA = Math.round(conceded * 0.92 * 10) / 10;

    await queryRun(db,
      `INSERT INTO team_stats (team_id, season, matches_played, goals_scored, goals_conceded, xG, xGA)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, season) DO UPDATE SET
         matches_played  = excluded.matches_played,
         goals_scored    = excluded.goals_scored,
         goals_conceded  = excluded.goals_conceded,
         xG              = excluded.xG,
         xGA             = excluded.xGA`,
      [team.id, season, played, scored, conceded, xG, xGA]
    );

    if (played > 0) {
      console.log(`   ${team.name.padEnd(32)} — ${played} trận | ${scored}G ${conceded}GA | W${wins} D${draws} L${losses}`);
    }
  }
}

// ─── Main seed logic ──────────────────────────────────────────────────────────

async function seed() {
  // Nhận league code từ command line argument (ví dụ: node seedHistorical.js WC)
  const leagueArg = process.argv[2]?.toUpperCase() || 'PL';
  const config = LEAGUE_CONFIG[leagueArg];

  if (!config) {
    console.error(`[Seed] ❌ Giải đấu không được hỗ trợ: "${leagueArg}"`);
    console.error(`[Seed]    Các giải hỗ trợ: ${Object.keys(LEAGUE_CONFIG).join(', ')}`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  Football Predictor — Seed lịch sử: ${config.name.padEnd(16)} ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (config.isNeutral) {
    console.log('ℹ️  Giải đấu sân trung lập — home advantage sẽ được tắt khi dự đoán');
  }

  const db = await initDatabase();
  let totalMatches = 0;

  for (const season of config.seasons) {
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`📅  Mùa giải: ${season} (${leagueArg})`);
    console.log('═'.repeat(55));

    // Step 1: Lấy danh sách đội
    console.log(`\n[Step 1] Lấy đội bóng ${leagueArg} ${season}...`);
    await sleep(DELAY_MS);

    let teamsData;
    try {
      teamsData = await fetchWithRetry(`${BASE_URL}/competitions/${leagueArg}/teams?season=${season}`);
    } catch (err) {
      console.warn(`[Seed] ⚠️  Bỏ qua mùa ${season}: ${err.message}`);
      continue;
    }

    const teams = teamsData.teams || [];
    console.log(`         → ${teams.length} đội`);

    for (const team of teams) {
      await upsertTeam(db, team, leagueArg);
    }

    // Step 2: Lấy kết quả trận đấu
    console.log(`\n[Step 2] Lấy kết quả trận ${leagueArg} ${season}...`);
    await sleep(DELAY_MS);

    let matchesData;
    try {
      matchesData = await fetchWithRetry(`${BASE_URL}/competitions/${leagueArg}/matches?season=${season}`);
    } catch (err) {
      console.warn(`[Seed] ⚠️  Bỏ qua kết quả mùa ${season}: ${err.message}`);
      continue;
    }

    const matches = matchesData.matches || [];
    let saved = 0;
    for (const match of matches) {
      const ok = await upsertMatch(db, match, leagueArg, season);
      if (ok) saved++;
    }
    console.log(`         → ${saved} trận đã lưu`);
    totalMatches += saved;

    // Step 3: Rebuild team_stats
    await rebuildTeamStats(db, leagueArg, season);

    console.log(`\n✅  Mùa ${season} hoàn thành.`);
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`🏁  Seed hoàn tất! Tổng: ${totalMatches} trận cho ${config.seasons.length} mùa giải ${leagueArg}.`);
  console.log('═'.repeat(55));

  if (leagueArg === 'WC') {
    console.log('\n💡 Để dự đoán trận World Cup 2026, thêm isNeutral: true vào body của API request:');
    console.log('   POST /api/predict/prematch');
    console.log('   { homeTeamId, awayTeamId, league: "WC", matchDate, isNeutral: true }');
  }

  process.exit(0);
}

seed().catch(err => {
  console.error('\n❌ Seed thất bại:', err.message);
  process.exit(1);
});
