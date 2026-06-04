/**
 * validateMatch.js — Middleware kiểm tra điều kiện trước khi dự đoán
 *
 * Điều kiện:
 * 1. Cả 2 đội phải tồn tại trong DB
 * 2. Mỗi đội phải có ít nhất 5 trận trong team_stats
 */

import { getDatabase, queryGet } from '../db/database.js';

const MIN_MATCHES = 5;

export async function validateMatch(req, res, next) {
  const { homeTeamId, awayTeamId } = req.body;

  // ── Basic input check ────────────────────────────────────────
  if (!homeTeamId || !awayTeamId) {
    return res.status(400).json({
      error: 'Thiếu thông tin đội bóng',
      detail: 'homeTeamId và awayTeamId là bắt buộc',
    });
  }

  if (homeTeamId === awayTeamId) {
    return res.status(400).json({
      error: 'Đội nhà và đội khách không thể giống nhau',
      detail: `Cả hai đều có ID: ${homeTeamId}`,
    });
  }

  try {
    const db = await getDatabase();

    // ── Check đội tồn tại ────────────────────────────────────────
    const homeTeam = await queryGet(db, 'SELECT id, name FROM teams WHERE id = ?', [homeTeamId]);
    if (!homeTeam) {
      return res.status(404).json({
        error: 'Không tìm thấy đội nhà',
        detail: `Không có đội nào với ID ${homeTeamId} trong cơ sở dữ liệu`,
      });
    }

    const awayTeam = await queryGet(db, 'SELECT id, name FROM teams WHERE id = ?', [awayTeamId]);
    if (!awayTeam) {
      return res.status(404).json({
        error: 'Không tìm thấy đội khách',
        detail: `Không có đội nào với ID ${awayTeamId} trong cơ sở dữ liệu`,
      });
    }

    // ── Check đủ dữ liệu thống kê ────────────────────────────────
    const homeStats = await queryGet(db,
      'SELECT matches_played FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1',
      [homeTeamId]
    );

    if (!homeStats || (homeStats.matches_played || 0) < MIN_MATCHES) {
      return res.status(422).json({
        error: 'Dữ liệu đội nhà không đủ',
        detail: `${homeTeam.name} chỉ có ${homeStats?.matches_played || 0} trận thống kê, cần ít nhất ${MIN_MATCHES} trận để dự đoán chính xác. Hãy chạy 'npm run seed' để nạp dữ liệu.`,
      });
    }

    const awayStats = await queryGet(db,
      'SELECT matches_played FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1',
      [awayTeamId]
    );

    if (!awayStats || (awayStats.matches_played || 0) < MIN_MATCHES) {
      return res.status(422).json({
        error: 'Dữ liệu đội khách không đủ',
        detail: `${awayTeam.name} chỉ có ${awayStats?.matches_played || 0} trận thống kê, cần ít nhất ${MIN_MATCHES} trận để dự đoán chính xác. Hãy chạy 'npm run seed' để nạp dữ liệu.`,
      });
    }

    // Gắn thêm thông tin đội vào request để route dùng lại (tránh query lại)
    req.homeTeam = homeTeam;
    req.awayTeam = awayTeam;
    req.homeStats = homeStats;
    req.awayStats = awayStats;

    next();
  } catch (err) {
    console.error('[validateMatch] Error:', err.message);
    res.status(500).json({
      error: 'Lỗi kiểm tra dữ liệu',
      detail: err.message,
    });
  }
}
