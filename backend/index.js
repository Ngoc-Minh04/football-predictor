import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './db/database.js';
import { seedSampleData } from './scrapers/footballData.js';
import { startScheduler } from './scrapers/scheduler.js';

import matchesRouter from './routes/matches.js';
import predictRouter from './routes/predict.js';
import teamsRouter from './routes/teams.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Static Frontend ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/matches', matchesRouter);
app.use('/api/predict', predictRouter);
app.use('/api/teams', teamsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Fallback: serve frontend index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── HTTP + WebSocket Server ───────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active live match subscriptions
const liveSubscriptions = new Map(); // matchId -> { probs, clients: Set }

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'subscribe_match') {
        const matchId = msg.matchId;
        if (!liveSubscriptions.has(matchId)) {
          liveSubscriptions.set(matchId, { probs: null, clients: new Set() });
        }
        liveSubscriptions.get(matchId).clients.add(ws);
        ws.matchId = matchId;
        ws.send(JSON.stringify({ type: 'subscribed', matchId }));
        console.log(`[WS] Client subscribed to match ${matchId}`);
      }
    } catch (err) {
      console.error('[WS] Message parse error:', err.message);
    }
  });

  ws.on('close', () => {
    if (ws.matchId && liveSubscriptions.has(ws.matchId)) {
      liveSubscriptions.get(ws.matchId).clients.delete(ws);
    }
    console.log('[WS] Client disconnected');
  });

  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

/**
 * Broadcast updated probabilities to all subscribers of a match
 */
export function broadcastProbabilityUpdate(matchId, data) {
  if (!liveSubscriptions.has(matchId)) return;
  const { clients } = liveSubscriptions.get(matchId);
  const msg = JSON.stringify({ type: 'probability_update', matchId, ...data });
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

// ─── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    // Initialize DB
    const db = await getDatabase();
    console.log('[Server] Database connected.');

    // Seed sample data if no teams exist yet
    const teamCount = await new Promise((res, rej) =>
      db.get('SELECT COUNT(*) as c FROM teams', (e, r) => e ? rej(e) : res(r?.c || 0))
    );
    if (teamCount === 0) {
      await seedSampleData(db);
    }

    // Start background cron scheduler (only if API key is set)
    if (process.env.FOOTBALL_DATA_API_KEY && process.env.FOOTBALL_DATA_API_KEY !== 'your_football_data_key_here') {
      startScheduler();
    } else {
      console.log('[Server] Football data API key not set — scheduler disabled, using sample data');
    }

    server.listen(PORT, () => {
      console.log(`\n🚀 Football Predictor running at http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

start();
