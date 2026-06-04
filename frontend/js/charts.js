/**
 * charts.js — Vanilla JS heatmap renderer for score matrix
 */

/**
 * Render a 7x7 score probability heatmap
 * @param {number[][]} matrix - score probability matrix
 * @param {string} homeTeam - home team name
 * @param {string} awayTeam - away team name
 */
function renderScoreMatrix(matrix, homeTeam, awayTeam) {
  const container = document.getElementById('scoreMatrixContainer');
  if (!container || !matrix) return;

  // Find max probability for color scaling
  let maxProb = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] > maxProb) maxProb = matrix[i][j];
    }
  }

  const table = document.createElement('table');
  table.className = 'score-matrix';

  // Header row (away goals)
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th style="color:#64748b;font-size:0.65rem">${awayTeam || 'Away'} →</th>`;
  for (let j = 0; j < matrix[0].length; j++) {
    headerRow.innerHTML += `<th>${j}</th>`;
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows (home goals)
  const tbody = document.createElement('tbody');
  for (let i = 0; i < matrix.length; i++) {
    const row = document.createElement('tr');
    // Row header (home goals)
    const th = document.createElement('th');
    th.textContent = i === 0 ? `${homeTeam?.split(' ')[0] || 'Home'} ↓   ${i}` : i;
    th.style.textAlign = 'left';
    row.appendChild(th);

    for (let j = 0; j < matrix[i].length; j++) {
      const td = document.createElement('td');
      const prob = matrix[i][j];
      const pct = (prob * 100).toFixed(1);

      // Color intensity based on probability
      const intensity = maxProb > 0 ? prob / maxProb : 0;
      const color = getHeatmapColor(intensity);

      td.style.background = color.bg;
      td.style.color = color.text;
      td.style.border = `1px solid ${color.border}`;
      td.textContent = pct + '%';
      td.title = `${homeTeam} ${i} - ${j} ${awayTeam}: ${pct}%`;
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

/**
 * Get heatmap color for a given intensity (0–1)
 */
function getHeatmapColor(intensity) {
  if (intensity > 0.85) {
    return {
      bg: 'rgba(59,130,246,0.65)',
      text: '#ffffff',
      border: 'rgba(59,130,246,0.8)',
    };
  } else if (intensity > 0.6) {
    return {
      bg: `rgba(99,102,241,${0.15 + intensity * 0.4})`,
      text: '#c7d2fe',
      border: 'rgba(99,102,241,0.3)',
    };
  } else if (intensity > 0.3) {
    return {
      bg: `rgba(255,255,255,${0.03 + intensity * 0.1})`,
      text: '#94a3b8',
      border: 'rgba(255,255,255,0.08)',
    };
  } else {
    return {
      bg: 'rgba(255,255,255,0.02)',
      text: '#475569',
      border: 'rgba(255,255,255,0.05)',
    };
  }
}

/**
 * Animate probability bars to target widths
 */
function animateProbBars(probs) {
  const homeEl  = document.getElementById('probHome');
  const drawEl  = document.getElementById('probDraw');
  const awayEl  = document.getElementById('probAway');
  const homeVal = document.getElementById('probHomeVal');
  const drawVal = document.getElementById('probDrawVal');
  const awayVal = document.getElementById('probAwayVal');

  // Set widths via requestAnimationFrame for smooth animation
  requestAnimationFrame(() => {
    if (homeEl)  homeEl.style.width  = `${(probs.home * 100).toFixed(0)}%`;
    if (drawEl)  drawEl.style.width  = `${(probs.draw * 100).toFixed(0)}%`;
    if (awayEl)  awayEl.style.width  = `${(probs.away * 100).toFixed(0)}%`;
    if (homeVal) homeVal.textContent = `${(probs.home * 100).toFixed(0)}%`;
    if (drawVal) drawVal.textContent = `${(probs.draw * 100).toFixed(0)}%`;
    if (awayVal) awayVal.textContent = `${(probs.away * 100).toFixed(0)}%`;
  });
}

/**
 * Render live probability bars in live mode panel
 */
function renderLiveProbBars(probs) {
  const container = document.getElementById('liveProbBars');
  if (!container) return;

  const labels = [
    { key: 'home', label: 'Đội nhà thắng', cls: 'home-fill' },
    { key: 'draw', label: 'Hòa', cls: 'draw-fill' },
    { key: 'away', label: 'Đội khách thắng', cls: 'away-fill' },
  ];

  container.innerHTML = labels.map(({ key, label, cls }) => `
    <div class="prob-bar-row">
      <span class="prob-label">${label}</span>
      <div class="prob-track">
        <div class="prob-fill ${cls}" style="width:${((probs[key] || 0) * 100).toFixed(0)}%"></div>
      </div>
      <span class="prob-value">${((probs[key] || 0) * 100).toFixed(0)}%</span>
    </div>
  `).join('');
}

/**
 * Render key factors list
 */
function renderFactors(factors) {
  const container = document.getElementById('factorsList');
  if (!container || !factors?.length) {
    if (container) container.innerHTML = '<p style="color:#64748b;font-size:0.83rem">Không có dữ liệu yếu tố.</p>';
    return;
  }

  const iconMap = {
    positive: '📈',
    negative: '📉',
    neutral: '➡️',
  };

  const labelMap = {
    positive: 'Tích cực',
    negative: 'Tiêu cực',
    neutral: 'Trung lập',
  };

  container.innerHTML = factors.map((f, idx) => {
    let rawImpact = f.impact;
    let impactNormalized = 'neutral';

    // Xử lý các dạng của impact (số, chuỗi tiếng Anh, chuỗi tiếng Việt)
    if (typeof rawImpact === 'number') {
      if (rawImpact > 0) impactNormalized = 'positive';
      else if (rawImpact < 0) impactNormalized = 'negative';
      else impactNormalized = 'neutral';
    } else if (typeof rawImpact === 'string') {
      const impLower = rawImpact.toLowerCase();
      if (impLower === 'positive' || impLower === 'tích cực' || impLower === 'tich cuc') {
        impactNormalized = 'positive';
      } else if (impLower === 'negative' || impLower === 'tiêu cực' || impLower === 'tieu cuc') {
        impactNormalized = 'negative';
      } else {
        impactNormalized = 'neutral';
      }
    }

    const icon = f.icon || iconMap[impactNormalized] || '📌';
    const dispLabel = labelMap[impactNormalized];

    return `
      <div class="factor-item" style="animation-delay:${idx * 60}ms">
        <span class="factor-icon">${icon}</span>
        <span class="factor-text">${f.factor || f.name || 'Unknown factor'}</span>
        <span class="factor-impact impact-${impactNormalized}">${dispLabel}</span>
      </div>
    `;
  }).join('');
}
