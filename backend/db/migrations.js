import { getDatabase, queryRun, queryAll } from './database.js';

export async function runMigrations() {
  console.log('[Migrations] Đang kiểm tra cấu trúc cơ sở dữ liệu...');
  try {
    const db = await getDatabase();
    
    // 1. Kiểm tra xem các cột xg_home và xg_away có trong bảng matches chưa
    const columns = await queryAll(db, "PRAGMA table_info(matches)");
    const hasXGHome = columns.some(col => col.name === 'xg_home');
    const hasXGAway = columns.some(col => col.name === 'xg_away');

    if (!hasXGHome) {
      console.log('[Migrations] Thêm cột xg_home vào bảng matches...');
      await queryRun(db, "ALTER TABLE matches ADD COLUMN xg_home REAL");
    }
    
    if (!hasXGAway) {
      console.log('[Migrations] Thêm cột xg_away vào bảng matches...');
      await queryRun(db, "ALTER TABLE matches ADD COLUMN xg_away REAL");
    }

    // 2. Kiểm tra xem các cột của odds_cache có đầy đủ không
    const oddsColumns = await queryAll(db, "PRAGMA table_info(odds_cache)");
    const hasHandicapValue = oddsColumns.some(col => col.name === 'handicap_value');
    const hasHandicapHomeProb = oddsColumns.some(col => col.name === 'handicap_home_prob');
    const hasHandicapAwayProb = oddsColumns.some(col => col.name === 'handicap_away_prob');
    const hasCorrectScoreOdds = oddsColumns.some(col => col.name === 'correct_score_odds');

    if (!hasHandicapValue) {
      console.log('[Migrations] Thêm cột handicap_value vào bảng odds_cache...');
      await queryRun(db, "ALTER TABLE odds_cache ADD COLUMN handicap_value REAL");
    }
    if (!hasHandicapHomeProb) {
      console.log('[Migrations] Thêm cột handicap_home_prob vào bảng odds_cache...');
      await queryRun(db, "ALTER TABLE odds_cache ADD COLUMN handicap_home_prob REAL");
    }
    if (!hasHandicapAwayProb) {
      console.log('[Migrations] Thêm cột handicap_away_prob vào bảng odds_cache...');
      await queryRun(db, "ALTER TABLE odds_cache ADD COLUMN handicap_away_prob REAL");
    }
    if (!hasCorrectScoreOdds) {
      console.log('[Migrations] Thêm cột correct_score_odds vào bảng odds_cache...');
      await queryRun(db, "ALTER TABLE odds_cache ADD COLUMN correct_score_odds TEXT");
    }

    console.log('[Migrations] Hoàn thành kiểm tra cơ sở dữ liệu.');
  } catch (err) {
    console.error('[Migrations] Lỗi khi chạy migrations:', err.message);
  }
}
