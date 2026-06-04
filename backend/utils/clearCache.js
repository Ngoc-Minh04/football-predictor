import { getDatabase, queryRun } from '../db/database.js';

async function main() {
  try {
    const db = await getDatabase();
    const res = await queryRun(db, 'DELETE FROM analysis_cache');
    console.log(`[Clear Cache] Đã xóa thành công ${res.changes} hàng cache phân tích AI cũ!`);
    process.exit(0);
  } catch (err) {
    console.error('[Clear Cache] Lỗi khi xóa cache:', err.message);
    process.exit(1);
  }
}

main();
