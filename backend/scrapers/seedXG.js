import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from '../db/database.js';
import { fetchXGData, saveXGToDb } from './understat.js';

async function seed() {
  console.log('[SeedXG] Đang lấy dữ liệu xG từ Understat...');
  const db = await getDatabase();
  const xgData = await fetchXGData('PL', 2024);
  if (xgData) {
    await saveXGToDb(db, xgData, 2024);
    console.log('[SeedXG] Seed dữ liệu xG thành công!');
  } else {
    console.error('[SeedXG] Không lấy được dữ liệu từ Understat.');
  }
  process.exit(0);
}

seed().catch(err => {
  console.error('[SeedXG] Lỗi:', err);
  process.exit(1);
});
