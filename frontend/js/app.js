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

const SQUAD_STARS = {
  "Argentina": ["Messi", "Lautaro", "Alvarez", "Di Maria", "Fernandez", "Mac Allister"],
  "France": ["Mbappe", "Griezmann", "Dembele", "Giroud", "Thuram"],
  "England": ["Kane", "Bellingham", "Saka", "Foden", "Palmer"],
  "Brazil": ["Vinicius", "Neymar", "Rodrygo", "Richarlison", "Raphinha"],
  "Portugal": ["Ronaldo", "Fernandes", "Silva", "Leao", "Felix"],
  "Spain": ["Yamal", "Morata", "Olmo", "Williams", "Torres"],
  "Germany": ["Musiala", "Wirtz", "Havertz", "Fullkrug", "Sane"],
  "Netherlands": ["Depay", "Gakpo", "Simons", "De Jong", "Van Dijk"],
  "Italy": ["Chiesa", "Barella", "Scamacca", "Retegui", "Donnarumma"],
  "Belgium": ["De Bruyne", "Lukaku", "Doku", "Trossard"],
  "Uruguay": ["Nunez", "Suarez", "Valverde", "Araujo"],
  "Croatia": ["Modric", "Kramaric", "Kovacic", "Perisic"],
  "Japan": ["Mitoma", "Kubo", "Endo", "Minamino"],
  "USA": ["Pulisic", "Balogun", "Weah", "McKennie"],
  "Mexico": ["Gimenez", "Lozano", "Alvarez", "Martin"],
  "Colombia": ["Diaz", "Rodriguez", "Borre", "Arias"],
  "Morocco": ["Ziyech", "En-Nesyri", "Hakimi", "Diaz", "Amrabat"],
  "Senegal": ["Mane", "Jackson", "Sarr", "Koulibaly"],
  "Denmark": ["Hojlund", "Eriksen", "Wind", "Christensen"],
  "Switzerland": ["Embolo", "Xhaka", "Shaqiri", "Akanji"],
  "South Korea": ["Son", "Hwang", "Lee", "Cho"],
  "Canada": ["David", "Davies", "Larin", "Buchanan"],
  "Ecuador": ["Valencia", "Caicedo", "Estupinan", "Rodriguez"],
  "Ukraine": ["Dovbyk", "Mudryk", "Tsygankov", "Zinchenko"],
  "Poland": ["Lewandowski", "Zielinski", "Swiderski", "Szczesny"],
  "Turkey": ["Yilmaz", "Guler", "Calhanoglu", "Akturkoglu"],
  "Austria": ["Sabitzer", "Gregoritsch", "Laimer", "Baumgartner"],
  "Sweden": ["Gyokeres", "Isak", "Kulusevski", "Elanga"],
  "Nigeria": ["Osimhen", "Lookman", "Boniface", "Iwobi"],
  "Ivory Coast": ["Haller", "Adingra", "Kessie", "Singo"],
  "Algeria": ["Mahrez", "Bounedjah", "Bennacer", "Aouar"],
  "Egypt": ["Salah", "Marmoush", "Mostafa", "Trezeguet"],
  "Saudi Arabia": ["Al-Dawsari", "Al-Shehri", "Al-Buraikan"],
  "Australia": ["Duke", "Boyle", "Goodwin", "Irvine"],
  "Cameroon": ["Aboubakar", "Toko Ekambi", "Mbeumo", "Anguissa"],
  "Liverpool FC": ["Salah", "Diaz", "Jota", "Nunez", "Gakpo"],
  "Manchester City FC": ["Haaland", "De Bruyne", "Foden", "Silva"],
  "Arsenal FC": ["Saka", "Odegaard", "Havertz", "Martinelli"],
  "Chelsea FC": ["Palmer", "Jackson", "Madueke", "Nkunku"],
  "Manchester United FC": ["Fernandes", "Rashford", "Hojlund", "Garnacho"],
  "Tottenham Hotspur FC": ["Son", "Richarlison", "Kulusevski", "Maddison"],
  "Aston Villa FC": ["Watkins", "Bailey", "McGinn"],
  "Newcastle United FC": ["Isak", "Gordon", "Guimaraes"]
};

const TEAM_ALIAS = {
  "bồ đào nha": "portugal",
  "bố đào nha": "portugal",
  "pháp": "france",
  "anh": "england",
  "tây ban nha": "spain",
  "đức": "germany",
  "hà lan": "netherlands",
  "ý": "italy",
  "bỉ": "belgium",
  "nhật bản": "japan",
  "mỹ": "usa",
  "united states": "usa",
  "colombia": "colombia",
  "ma-rốc": "morocco",
  "morocco": "morocco",
  "senegal": "senegal",
  "đan mạch": "denmark",
  "thụy sĩ": "switzerland",
  "hàn quốc": "south korea",
  "south korea": "south korea",
  "canada": "canada",
  "ecuador": "ecuador",
  "ukraine": "ukraine",
  "ba lan": "poland",
  "thổ nhĩ kỳ": "turkey",
  "áo": "austria",
  "thụy điển": "sweden",
  "nigeria": "nigeria",
  "bờ biển ngà": "ivory coast",
  "algeria": "algeria",
  "ai cập": "egypt",
  "ả rập xê út": "saudi arabia",
  "úc": "australia",
  "cameroon": "cameroon",
  "man city": "manchester city",
  "man utd": "manchester united",
  "leeds utd": "leeds united",
  "sheffield utd": "sheffield united",
  "wolves": "wolverhampton",
  "west ham": "west ham united"
};

function updateSquadStars(selectEl, playersContainerId, teamLabelId, roleLabel) {
  const container = document.getElementById(playersContainerId);
  const label = document.getElementById(teamLabelId);
  if (!container || !label) return;

  const teamId = selectEl.value;
  if (!teamId) {
    label.textContent = roleLabel;
    container.innerHTML = `<p class="text-muted">Chọn đội để xem danh sách ngôi sao...</p>`;
    return;
  }

  const option = selectEl.options[selectEl.selectedIndex];
  const teamName = option ? option.textContent : '';
  label.textContent = `${roleLabel} (${teamName})`;

  let matchedStars = null;
  const teamShort = teamName.replace(/ (FC|Club|AC|UD|Real|RC)$/i, "").toLowerCase().trim();
  const resolvedName = TEAM_ALIAS[teamShort] || teamShort;
  
  for (const [key, stars] of Object.entries(SQUAD_STARS)) {
    const keyShort = key.replace(" FC", "").toLowerCase().trim();
    if (resolvedName.includes(keyShort) || keyShort.includes(resolvedName)) {
      matchedStars = stars;
      break;
    }
  }

  if (!matchedStars || matchedStars.length === 0) {
    container.innerHTML = `<p class="text-muted">Không có danh sách siêu sao mặc định cho đội này.</p>`;
    return;
  }

  container.innerHTML = matchedStars.map(player => `
    <label class="player-checkbox-label">
      <input type="checkbox" name="${playersContainerId}_player" value="${player}" />
      <span>${player}</span>
    </label>
  `).join('');
}

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
    <h2 class="card-title">🤖 Gemini AI Phân Tích</h2>
    <div class="ai-thinking">
      <span>Gemini đang phân tích trận đấu</span>
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
    <div class="value-bets-box" id="valueBetsBox">
      <h3 class="value-bets-title">🎯 Tỷ Số Vàng (+EV) cược nhà cái</h3>
      <div class="value-bets-list" id="valueBetsList">
        <p class="text-muted" style="font-size:0.8rem">Không có dữ liệu tỷ số cược nhà cái hoặc không có tỷ số +EV.</p>
      </div>
    </div>
  `;

  document.querySelector('.ai-card').innerHTML = `
    <h2 class="card-title">🤖 Gemini AI Phân Tích</h2>
    <div class="risk-badge" id="riskBadge">--</div>
    <p class="ai-summary" id="aiSummary"></p>
    <div class="ai-recommendation" id="aiRecommendation"></div>
    <div class="ai-lineup-analysis hidden" id="aiLineupAnalysisBox">
      <h3 class="lineup-analysis-title">📋 Phân Tích Đội Hình & Chiến Thuật</h3>
      <p class="lineup-analysis-text" id="aiLineupAnalysisText"></p>
    </div>
  `;
}

// ── Initialization ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Lấy ngày hôm nay theo múi giờ địa phương (local time) thay vì UTC
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  matchDateInput.value = `${yyyy}-${mm}-${dd}`;

  await loadTeams('PL');

  leagueSelect.addEventListener('change', () => loadTeams(leagueSelect.value));
  predictBtn.addEventListener('click', runPrediction);
  liveModeBtn.addEventListener('click', toggleLiveMode);

  const oddsAccordion = document.getElementById('oddsAccordion');
  const toggleOddsBtn = document.getElementById('toggleOddsBtn');
  if (toggleOddsBtn && oddsAccordion) {
    toggleOddsBtn.addEventListener('click', () => {
      oddsAccordion.classList.toggle('open');
    });
  }

  const injuriesAccordion = document.getElementById('injuriesAccordion');
  const toggleInjuriesBtn = document.getElementById('toggleInjuriesBtn');
  if (toggleInjuriesBtn && injuriesAccordion) {
    toggleInjuriesBtn.addEventListener('click', () => {
      injuriesAccordion.classList.toggle('open');
    });
  }

  const lineupsAccordion = document.getElementById('lineupsAccordion');
  const toggleLineupsBtn = document.getElementById('toggleLineupsBtn');
  if (toggleLineupsBtn && lineupsAccordion) {
    toggleLineupsBtn.addEventListener('click', () => {
      lineupsAccordion.classList.toggle('open');
    });
  }

  homeTeamSelect.addEventListener('change', () => {
    updateSquadStars(homeTeamSelect, 'injuryHomePlayers', 'injuryHomeTeamLabel', 'Đội nhà');
    const option = homeTeamSelect.options[homeTeamSelect.selectedIndex];
    const teamName = option ? option.textContent : '';
    const lineupLabel = document.getElementById('lineupHomeTeamLabel');
    if (lineupLabel) {
      lineupLabel.textContent = teamName ? `Đội hình Đội nhà (${teamName})` : 'Đội hình Đội nhà';
    }
  });
  awayTeamSelect.addEventListener('change', () => {
    updateSquadStars(awayTeamSelect, 'injuryAwayPlayers', 'injuryAwayTeamLabel', 'Đội khách');
    const option = awayTeamSelect.options[awayTeamSelect.selectedIndex];
    const teamName = option ? option.textContent : '';
    const lineupLabel = document.getElementById('lineupAwayTeamLabel');
    if (lineupLabel) {
      lineupLabel.textContent = teamName ? `Đội hình Đội khách (${teamName})` : 'Đội hình Đội khách';
    }
  });

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
    updateSquadStars(homeTeamSelect, 'injuryHomePlayers', 'injuryHomeTeamLabel', 'Đội nhà');
    updateSquadStars(awayTeamSelect, 'injuryAwayPlayers', 'injuryAwayTeamLabel', 'Đội khách');
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
      isHomeAdvantage: document.getElementById('isHomeAdvantage').checked,
    };

    const [homeFormResult, awayFormResult] = await Promise.allSettled([
      fetchTeamForm(homeTeamId),
      fetchTeamForm(awayTeamId),
    ]);

    const customOdds = {
      homeOdd: document.getElementById('oddHome').value || null,
      drawOdd: document.getElementById('oddDraw').value || null,
      awayOdd: document.getElementById('oddAway').value || null,
      over25Odd: document.getElementById('oddOver').value || null,
      under25Odd: document.getElementById('oddUnder').value || null,
    };

    const handicapValue = document.getElementById('handicapValue').value;
    const handicapHomeOdd = document.getElementById('handicapHomeOdd').value;
    const handicapAwayOdd = document.getElementById('handicapAwayOdd').value;

    let customHandicap = null;
    if (handicapValue !== "" && handicapHomeOdd && handicapAwayOdd) {
      customHandicap = {
        handicap: parseFloat(handicapValue),
        homeOdd: parseFloat(handicapHomeOdd),
        awayOdd: parseFloat(handicapAwayOdd)
      };
    }

    // Gather checked absences
    const homeChecked = Array.from(document.querySelectorAll('input[name="injuryHomePlayers_player"]:checked')).map(el => el.value);
    const awayChecked = Array.from(document.querySelectorAll('input[name="injuryAwayPlayers_player"]:checked')).map(el => el.value);
    const customText = document.getElementById('customInjuriesInput').value.trim();

    let injuriesString = '';
    const homeInjStr = homeChecked.map(p => `${p} vắng mặt`).join(', ');
    const awayInjStr = awayChecked.map(p => `${p} vắng mặt`).join(', ');

    if (homeInjStr || awayInjStr || customText) {
      const optionHome = homeTeamSelect.options[homeTeamSelect.selectedIndex];
      const optionAway = awayTeamSelect.options[awayTeamSelect.selectedIndex];
      const homeName = optionHome ? optionHome.textContent : 'Home';
      const awayName = optionAway ? optionAway.textContent : 'Away';

      // Always prefix both teams to ensure we have the '|' separator and prevent ambiguity in the backend
      const parts = [
        `${homeName}: ${homeInjStr}`,
        `${awayName}: ${awayInjStr}`
      ];
      if (customText) {
        parts.push(`Khác: ${customText}`);
      }
      injuriesString = parts.join(' | ');
    }

    const homeLineup = document.getElementById('homeLineupInput')?.value || '';
    const awayLineup = document.getElementById('awayLineupInput')?.value || '';

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
        isNeutral: leagueSelect.value === 'WC' || leagueSelect.value === 'EC',
        isKnockout: document.getElementById('isKnockout').checked,
        weather: document.getElementById('weatherSelect').value || 'fine',
        referee: document.getElementById('refereeSelect').value || 'normal',
        injuries: injuriesString,
        customOdds,
        customHandicap,
        homeLineup,
        awayLineup,
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

  // Render Value Bets (+EV)
  const valueBetsList = document.getElementById('valueBetsList');
  if (valueBetsList) {
    const valueBets = pred.valueBets || [];
    if (valueBets.length > 0) {
      valueBetsList.innerHTML = valueBets.map(bet => `
        <div class="value-bet-item">
          <div class="value-bet-score-info">
            <span class="value-bet-score">${bet.score.home} - ${bet.score.away}</span>
            <span class="value-bet-details">(Odds: ${bet.odds} | Xác suất: ${Math.round(bet.prob * 100)}%)</span>
          </div>
          <span class="value-bet-ev">+${Math.round(bet.ev * 100)}% EV</span>
        </div>
      `).join('');
    } else {
      valueBetsList.innerHTML = `<p class="text-muted" style="font-size:0.8rem">Không có tỷ số nào có giá trị kỳ vọng (+EV) dương tại thời điểm này.</p>`;
    }
  }

  const aiAnalysis = pred.aiAnalysis || {};
  const riskRaw = aiAnalysis.riskLevel || 'medium';
  // Map tiếng Việt → CSS class tiếng Anh để giữ styling nhất quán
  const riskClassMap = { 'thấp': 'low', 'trung bình': 'medium', 'cao': 'high', 'low': 'low', 'medium': 'medium', 'high': 'high' };
  const riskClass = riskClassMap[riskRaw.toLowerCase()] || 'medium';
  const riskLabelMap = { 'low': 'Thấp', 'medium': 'Trung bình', 'high': 'Cao', 'thấp': 'Thấp', 'trung bình': 'Trung bình', 'cao': 'Cao' };
  const riskLabel = riskLabelMap[riskRaw.toLowerCase()] || riskRaw;
  const riskEl = document.getElementById('riskBadge');
  riskEl.textContent = `⚠️ Rủi ro: ${riskLabel}`;
  riskEl.className = `risk-badge ${riskClass}`;

  document.getElementById('aiSummary').textContent = aiAnalysis.summary || 'Không có phân tích AI.';
  const recEl = document.getElementById('aiRecommendation');
  if (aiAnalysis.recommendation) {
    recEl.textContent = `💡 ${aiAnalysis.recommendation}`;
    recEl.style.display = 'block';
  } else {
    recEl.style.display = 'none';
  }

  const lineupAnalysisBox = document.getElementById('aiLineupAnalysisBox');
  const lineupAnalysisText = document.getElementById('aiLineupAnalysisText');
  if (pred.aiLineupAnalysis && lineupAnalysisBox && lineupAnalysisText) {
    lineupAnalysisText.textContent = pred.aiLineupAnalysis;
    lineupAnalysisBox.classList.remove('hidden');
  } else if (lineupAnalysisBox) {
    lineupAnalysisBox.classList.add('hidden');
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
