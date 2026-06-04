import express from 'express';
import { getDatabase, queryAll, queryGet } from '../db/database.js';

const router = express.Router();

/**
 * GET /api/teams
 * Returns all teams in DB
 */
router.get('/', async (req, res) => {
  try {
    const db = await getDatabase();
    const { league } = req.query;

    let sql = 'SELECT * FROM teams';
    const params = [];
    if (league) { sql += ' WHERE league = ?'; params.push(league); }
    sql += ' ORDER BY name ASC';

    const teams = await queryAll(db, sql, params);
    res.json({ teams });
  } catch (err) {
    console.error('[API/teams] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/teams/:id/stats
 * Returns team stats + last N matches form
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const db = await getDatabase();
    const teamId = parseInt(req.params.id);
    const last = parseInt(req.query.last || '10');

    const team = await queryGet(db, 'SELECT * FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const stats = await queryGet(db,
      'SELECT * FROM team_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1',
      [teamId]
    );

    // Recent matches
    const recentMatches = await queryAll(db,
      `SELECT m.*, 
        ht.name as home_team_name, 
        at.name as away_team_name
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE (m.home_team_id = ? OR m.away_team_id = ?) 
         AND m.status = 'FINISHED'
       ORDER BY m.date DESC
       LIMIT ?`,
      [teamId, teamId, last]
    );

    // Build form string (W/D/L from team's perspective)
    const form = recentMatches.map(m => {
      if (m.score_home === null) return 'U';
      const isHome = m.home_team_id === teamId;
      const teamGoals = isHome ? m.score_home : m.score_away;
      const oppGoals = isHome ? m.score_away : m.score_home;
      if (teamGoals > oppGoals) return 'W';
      if (teamGoals === oppGoals) return 'D';
      return 'L';
    });

    // ELO history
    const eloHistory = await queryAll(db,
      'SELECT * FROM elo_history WHERE team_id = ? ORDER BY date DESC LIMIT 10',
      [teamId]
    );

    res.json({
      team,
      stats: stats || {},
      form,
      recentMatches,
      eloHistory,
    });
  } catch (err) {
    console.error('[API/teams/:id/stats] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
