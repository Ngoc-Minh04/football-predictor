/**
 * websocket.js — WebSocket client for live match updates
 */

let ws = null;
let reconnectTimer = null;
const WS_URL = `ws://${window.location.host}`;

function updateWsStatus(connected) {
  const el = document.getElementById('wsStatus');
  if (!el) return;
  el.classList.toggle('connected', connected);
  el.title = connected ? 'WebSocket: Connected' : 'WebSocket: Disconnected';
}

function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
      console.log('[WS] Connected');
      updateWsStatus(true);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'probability_update') {
          handleProbabilityUpdate(msg);
        }
      } catch (e) {
        console.error('[WS] Message parse error:', e.message);
      }
    });

    ws.addEventListener('close', () => {
      console.log('[WS] Disconnected');
      updateWsStatus(false);
      // Auto-reconnect after 3s
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener('error', () => {
      ws?.close();
    });
  } catch (e) {
    updateWsStatus(false);
  }
}

function subscribeToMatch(matchId) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe_match', matchId }));
  }
}

function handleProbabilityUpdate(msg) {
  if (!msg.updatedProbabilities) return;
  // Update live probability bars
  renderLiveProbBars(msg.updatedProbabilities);

  // Update live score if present
  if (msg.score) {
    const homeEl = document.getElementById('liveHomeScore');
    const awayEl = document.getElementById('liveAwayScore');
    if (homeEl) homeEl.textContent = msg.score.home;
    if (awayEl) awayEl.textContent = msg.score.away;
  }

  if (msg.minute) {
    const minEl = document.getElementById('liveMinute');
    if (minEl) minEl.textContent = `${msg.minute}'`;
  }

  console.log('[WS] Live update received:', msg.updatedProbabilities);
}

// Start connection on page load
connectWebSocket();
