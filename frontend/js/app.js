/**
 * app.js — Main frontend logic
 * Bao gồm: skeleton loading, blinking AI, toast notifications
 */

const API = window.location.origin;

// ── State ──────────────────────────────────────────────────────
let allTeams = [];
let currentPrediction = null;
let liveEvents = [];
let currentMatchId = null;
let isLiveMode = false;

// ── DOM Refs ───────────────────────────────────────────────────
const leagueSelect   = document.getElementById('leagueSelect');
const homeTeamSelect = document.getElementById('homeTeamSelect');
const awayTeamSelect = document.getElementById('awayTeamSelect');
const matchDateInput = document.getElementById('matchDate');
const predictBtn     = document.getElementById('predictBtn');
const liveModeBtn    = document.getElementById('liveModeBtn');
const loadingState   = document.getElementById('loadingState');
const predResults    = document.getElementById('predictionResults');
const livePanel      = document.getElementById('livePanel');

// ══════════════════════════════════════════════════════════════════
//  TOAST NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════════

const TOAST_ICONS = {
  error:   '🚨',
  warn:    '⚠️',
  success: '✅',
  info:    'ℹ️',
};

/**
 * Hiển thị toast notification ở góc dưới phải màn hình
 * @param {string} title - Tiêu đề ngắn
 * @param {string} detail - Chi tiết lỗi / thông tin
 * @param {'error'|'warn'|'success'|'info'} type
 * @param {number} duration - Thời gian tự đóng (ms), 0 = không tự đóng
 */
function showToast(title, detail = '', type = 'error', duration = 6000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || '📢'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${detail ? `<div class="toast-detail">${detail}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Đóng">×</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  closeBtn.addEventListener('click', dismiss);

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return toast;
}

// ══════════════════════════════════════════════════════════════════
//  SKELETON LOADING
// ══════════════════════════════════════════════════════════════════

/**
 * Hiển thị skeleton cho prediction card trong lúc chờ API
 */
function showSkeletonResults() {
  predResults.classList.remove('hidden');

  // Skeleton cho prediction card
  document.getElementById('predictionCard').innerHTML = `
    <h2 class="card-title">📊 Kết Quả Dự Đoán</h2>
    <div class="match-header">
      <div class="team-block home">
        <div class="skeleton skeleton-team"></div>
        <div class="skeleton-badges">
          ${[...Array(5)].map(() => '<div class="skeleton skeleton-badge-sm"></div>').join('')}
        </div>
      </div>
      <div class="score-block skeleton-score-block">
        <div class="skeleton skeleton-score"></div>
        <div class="skeleton skeleton-label"></div>
        <div class="skeleton skeleton-badge"></div>
      </div>
      <div class="team-block away">
        <div class="skeleton skeleton-team"></div>
        <div class="skeleton-badges">
          ${[...Array(5)].map(() => '<div class="skeleton skeleton-badge-sm"></div>').join('')}
        </div>
      </div>
    </div>
    <div class="prob-bars">
      ${['Đội nhà thắng', 'Hòa', 'Đội khách thắng'].map(() => `
        <div class="skeleton-bar-row">
          <div class="skeleton skeleton-text-sm"></div>
          <div class="skeleton skeleton-bar"></div>
          <div class="skeleton skeleton-text-xs"></div>
        </div>
      `).join('')}
    </div>
    <div class="skeleton-ou-row">
      <div class="skeleton-ou-block">
        <div class="skeleton skeleton-ou-label"></div>
        <div class="skeleton skeleton-ou-value"></div>
      </div>
      <div style="width:1px;background:var(--border)"></div>
      <div class="skeleton-ou-block">
        <div class="skeleton skeleton-ou-label"></div>
        <div class="skeleton skeleton-ou-value"></div>
      </div>
    </div>
  `;

  // Skeleton + blinking AI cho AI card
  document.querySelector('.ai-card').innerHTML = `
    <h2 class="card-title">🤖 Claude AI Phân Tích</h2>
    <div class="ai-thinking">
      <span>Claude đang phân tích trận đấu</span>
      <div class="ai-thinking-dot">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div class="skeleton-ai">
      <div class="skeleton skeleton-ai-badge"></div>
      <div class="skeleton skeleton-ai-line-lg"></div>
      <div class="skeleton skeleton-ai-line-md"></div>
      <div class="skeleton skeleton-ai-line-sm"></div>
      <div class="skeleton skeleton-ai-box"></div>
    </div>
  `;

  // Skeleton cho matrix
  document.getElementById('scoreMatrixContainer').innerHTML =
    `<div class="skeleton" style="height:200px;width:100%"></div>`;

  // Skeleton cho factors
  document.getElementById('factorsList').innerHTML = `
    ${[...Array(3)].map(() => `
      <div class="factor-item">
        <div class="skeleton" style="width:24px;height:24px;border-radius:6px;flex-shrink:0"></div>
        <div class="skeleton" style="height:12px;flex:1;border-radius:4px"></div>
        <div class="skeleton" style="width:60px;height:20px;border-radius:12px"></div>
      </div>
    `).join('')}
  `;

  predResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Khôi phục lại cấu trúc HTML gốc của prediction card sau khi skeleton
 */
function restorePredictionCard() {
  document.getElementById('predictionCard').innerHTML = `
    <h2 class="card-title">📊 Kết Quả Dự Đoán</h2>
    <div class="match-header">
      <div class="team-block home">
        <span class="team-name" id="homeTeamName">--</span>
        <div class="form-badges" id="homeFormBadges"></div>
      </div>
      <div class="score-block">
        <div class="predicted-score">
          <span id="scoreHome" class="score-digit">0</span>
          <span class="score-sep">:</span>
          <span id="scoreAway" class="score-digit">0</span>
        </div>
        <div class="score-label">Tỷ số dự đoán</div>
        <div class="confidence-badge" id="confidenceBadge">
          Độ tin cậy: <strong id="confidenceValue">--</strong>
        </div>
      </div>
      <div class="team-block away">
        <span class="team-name" id="awayTeamName">--</span>
        <div class="form-badges" id="awayFormBadges"></div>
      </div>
    </div>
    <div class="prob-bars">
      <div class="prob-bar-row">
        <span class="prob-label">Đội nhà thắng</span>
        <div class="prob-track"><div class="prob-fill home-fill" id="probHome"></div></div>
        <span class="prob-value" id="probHomeVal">--</span>
      </div>
      <div class="prob-bar-row">
        <span class="prob-label">Hòa</span>
        <div class="prob-track"><div class="prob-fill draw-fill" id="probDraw"></div></div>
        <span class="prob-value" id="probDrawVal">--</span>
      </div>
      <div class="prob-bar-row">
        <span class="prob-label">Đội khách thắng</span>
        <div class="prob-track"><div class="prob-fill away-fill" id="probAway"></div></div>
        <span class="prob-value" id="probAwayVal">--</span>
      </div>
    </div>
    <div class="ou-row">
      <div class="ou-block">
        <span class="ou-label">Over 2.5</span>
        <span class="ou-value" id="over25">--</span>
      </div>
      <div class="ou-divider"></div>
      <div class="ou-block">
        <span class="ou-label">Under 2.5</span>
        <span class="ou-value" id="under25">--</span>
      </div>
    </div>
  `;

  document.querySelector('.ai-card').innerHTML = `
    <h2 class="card-title">🤖 Claude AI Phân Tích</h2>
    <div class="risk-badge" id="riskBadge">--</div>
    <p class="ai-summary" id="aiSummary"></p>
    <div class="ai-recommendation" id="aiRecommendation"></div>
  `;
}

// ── Initialization ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  matchDateInput.value = new Date().toISOString().split('T')[0];

  await loadTeams('PL');

  leagueSelect.addEventListener('change', () => loadTeams(leagueSelect.value));
  predictBtn.addEventListener('click', runPrediction);
  liveModeBtn.addEventListener('click', toggleLiveMode);

  document.getElementById('btnGoalHome').addEventListener('click', () => addLiveEvent('goal', 'home'));
  document.getElementById('btnGoalAway').addEventListener('click', () => addLiveEvent('goal', 'away'));
  document.getElementById('btnRedHome').addEventListener('click',  () => addLiveEvent('red_card', 'home'));
  document.getElementById('btnRedAway').addEventListener('click',  () => addLiveEvent('red_card', 'away'));
  document.getElementById('updateLiveBtn').addEventListener('click', updateLive);
});

// ── Load Teams ─────────────────────────────────────────────────
async function loadTeams(league = 'PL') {
  try {
    const res = await fetch(`${API}/api/teams?league=${league}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allTeams = data.teams || [];
    populateTeamDropdown(homeTeamSelect, allTeams, 'Chọn đội nhà');
    populateTeamDropdown(awayTeamSelect, allTeams, 'Chọn đội khách');
  } catch (err) {
    showToast('Không tải được danh sách đội', err.message, 'error');
  }
}

function populateTeamDropdown(select, teams, placeholder) {
  const current = select.value;
  select.innerHTML = `<option value="">-- ${placeholder} --</option>`;
  for (const team of teams) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.name;
    if (String(team.id) === current) opt.selected = true;
    select.appendChild(opt);
  }
}

// ── Prediction ─────────────────────────────────────────────────
async function runPrediction() {
  const homeTeamId = homeTeamSelect.value;
  const awayTeamId = awayTeamSelect.value;

  if (!homeTeamId || !awayTeamId) {
    showToast('Chưa chọn đội bóng', 'Vui lòng chọn cả đội nhà và đội khách', 'warn');
    return;
  }
  if (homeTeamId === awayTeamId) {
    showToast('Đội không hợp lệ', 'Đội nhà và đội khách không thể là cùng một đội', 'warn');
    return;
  }

  // Hiển thị skeleton ngay lập tức
  setLoading(true);
  showSkeletonResults();

  try {
    const situationalFactors = {
      isDerby:         document.getElementById('isDerby').checked,
      isImportantMatch: document.getElementById('isImportant').checked,
      homeFatigue:     document.getElementById('homeFatigue').checked,
      awayFatigue:     document.getElementById('awayFatigue').checked,
    };

    const [homeFormResult, awayFormResult] = await Promise.allSettled([
      fetchTeamForm(homeTeamId),
      fetchTeamForm(awayTeamId),
    ]);

    const res = await fetch(`${API}/api/predict/prematch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        homeTeamId: parseInt(homeTeamId),
        awayTeamId: parseInt(awayTeamId),
        league: leagueSelect.value,
        matchDate: matchDateInput.value || null,
        situationalFactors,
        homeForm: homeFormResult.status === 'fulfilled' ? homeFormResult.value.join('') : '',
        awayForm: awayFormResult.status === 'fulfilled' ? awayFormResult.value.join('') : '',
      }),
    });

    if (!res.ok) {
      // Đọc body lỗi và hiển thị toast chi tiết
      const errData = await res.json().catch(() => ({}));
      const title = errData.error || `Lỗi API (${res.status})`;
      const detail = errData.detail || '';
      showToast(title, detail, res.status >= 500 ? 'error' : 'warn');
      predResults.classList.add('hidden');
      return;
    }

    const prediction = await res.json();
    currentPrediction = prediction;
    liveEvents = [];

    // Khôi phục DOM gốc rồi điền dữ liệu
    restorePredictionCard();
    displayPrediction(
      prediction,
      homeFormResult.status === 'fulfilled' ? homeFormResult.value : [],
      awayFormResult.status === 'fulfilled' ? awayFormResult.value : []
    );

    showToast(
      'Dự đoán hoàn thành',
      `${prediction.homeTeam} vs ${prediction.awayTeam} — Confidence: ${Math.round((prediction.confidence || 0) * 100)}%`,
      'success',
      3000
    );
  } catch (err) {
    console.error('Prediction failed:', err);
    showToast('Lỗi kết nối', `Không thể kết nối đến server: ${err.message}`, 'error');
    predResults.classList.add('hidden');
  } finally {
    setLoading(false);
  }
}

async function fetchTeamForm(teamId) {
  const res = await fetch(`${API}/api/teams/${teamId}/stats?last=5`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.form || [];
}

// ── Display Prediction ─────────────────────────────────────────
function displayPrediction(pred, homeForm, awayForm) {
  document.getElementById('homeTeamName').textContent = pred.homeTeam;
  document.getElementById('awayTeamName').textContent = pred.awayTeam;

  animateCounter('scoreHome', pred.score?.home ?? 0);
  animateCounter('scoreAway', pred.score?.away ?? 0);

  const conf = Math.round((pred.confidence || 0) * 100);
  document.getElementById('confidenceValue').textContent = `${conf}%`;
  const confEl = document.getElementById('confidenceBadge');
  confEl.style.background = conf > 70
    ? 'rgba(34,197,94,0.1)'
    : conf > 50
      ? 'rgba(245,158,11,0.1)'
      : 'rgba(239,68,68,0.1)';

  renderFormBadges('homeFormBadges', homeForm);
  renderFormBadges('awayFormBadges', awayForm);

  setTimeout(() => animateProbBars(pred.result || { home: 0, draw: 0, away: 0 }), 100);

  document.getElementById('over25').textContent  = `${Math.round((pred.overUnder?.over25  || 0) * 100)}%`;
  document.getElementById('under25').textContent = `${Math.round((pred.overUnder?.under25 || 0) * 100)}%`;

  const aiAnalysis = pred.aiAnalysis || {};
  const risk = aiAnalysis.riskLevel || 'medium';
  const riskEl = document.getElementById('riskBadge');
  riskEl.textContent = `Rủi ro: ${risk.toUpperCase()}`;
  riskEl.className = `risk-badge ${risk}`;

  document.getElementById('aiSummary').textContent = aiAnalysis.summary || 'Không có phân tích AI.';
  const recEl = document.getElementById('aiRecommendation');
  if (aiAnalysis.recommendation) {
    recEl.textContent = `💡 ${aiAnalysis.recommendation}`;
    recEl.style.display = 'block';
  } else {
    recEl.style.display = 'none';
  }

  if (pred.scoreMatrix) {
    renderScoreMatrix(pred.scoreMatrix, pred.homeTeam, pred.awayTeam);
  }

  renderFactors(pred.factors || []);
}

// ── Form Badges ────────────────────────────────────────────────
function renderFormBadges(containerId, form) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = form.slice(0, 5).map(r =>
    `<span class="badge badge-${r}">${r}</span>`
  ).join('');
}

// ── Animated Counter ───────────────────────────────────────────
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = target;
  el.style.transform = 'scale(1.3)';
  el.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
}

// ── Live Mode ──────────────────────────────────────────────────
function toggleLiveMode() {
  isLiveMode = !isLiveMode;
  livePanel.classList.toggle('hidden', !isLiveMode);
  document.getElementById('liveIndicator').classList.toggle('active', isLiveMode);
  liveModeBtn.classList.toggle('btn-primary', isLiveMode);
  liveModeBtn.classList.toggle('btn-secondary', !isLiveMode);

  if (isLiveMode && currentPrediction) {
    if (currentMatchId) subscribeToMatch(currentMatchId);
    renderLiveProbBars(currentPrediction.result || { home: 0.4, draw: 0.27, away: 0.33 });
    showToast('Live Mode bật', 'Đang theo dõi cập nhật xác suất real-time', 'info', 3000);
  }
}

function addLiveEvent(type, team) {
  const minute = parseInt(document.getElementById('liveMinuteInput').value) || 45;
  liveEvents.push({ type, team, minute });
  updateLive();
}

async function updateLive() {
  if (!currentPrediction?.result) {
    showToast('Chưa có dự đoán', 'Hãy chạy dự đoán trước khi dùng Live Mode', 'warn');
    return;
  }

  const minute    = parseInt(document.getElementById('liveMinuteInput').value) || 45;
  const scoreHome = parseInt(document.getElementById('liveScoreHome').value) || 0;
  const scoreAway = parseInt(document.getElementById('liveScoreAway').value) || 0;

  document.getElementById('liveMinute').textContent  = `${minute}'`;
  document.getElementById('liveHomeScore').textContent = scoreHome;
  document.getElementById('liveAwayScore').textContent = scoreAway;

  try {
    const res = await fetch(`${API}/api/predict/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: currentMatchId,
        priorProbs: currentPrediction.result,
        minute,
        score: { home: scoreHome, away: scoreAway },
        events: liveEvents,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('Lỗi cập nhật live', err.error || `HTTP ${res.status}`, 'error');
      return;
    }

    const data = await res.json();
    renderLiveProbBars(data.updatedProbabilities);
  } catch (err) {
    showToast('Lỗi kết nối live', err.message, 'error');
  }
}

// ── Loading State ──────────────────────────────────────────────
function setLoading(loading) {
  loadingState.classList.add('hidden'); // Không dùng spinner nữa — skeleton thay thế
  predictBtn.disabled = loading;
  predictBtn.innerHTML = loading
    ? '<span class="btn-icon">⏳</span> Đang tính...'
    : '<span class="btn-icon">🔮</span> Dự đoán ngay';
}
