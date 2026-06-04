import express from 'express';
import { getDatabase, queryAll } from '../db/database.js';

const router = express.Router();

/**
 * GET /api/matches
 * Query params: league, date (YYYY-MM-DD), status
 */
router.get('/', async (req, res) => {
  try {
    const db = await getDatabase();
    const { league, date, status } = req.query;

    let sql = `
      SELECT m.*, 
        ht.name as home_team_name, 
        at.name as away_team_name
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      WHERE 1=1
    `;
    const params = [];

    if (league) { sql += ' AND m.league = ?'; params.push(league); }
    if (date)   { sql += ' AND m.date = ?';   params.push(date); }
    if (status) { sql += ' AND m.status = ?'; params.push(status); }

    sql += ' ORDER BY m.date DESC LIMIT 100';

    const matches = await queryAll(db, sql, params);
    res.json({ matches, count: matches.length });
  } catch (err) {
    console.error('[API/matches] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
