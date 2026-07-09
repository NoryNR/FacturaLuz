/* ============================================================
   LuzHoy — Main Application
   API: ESIOS (Red Eléctrica de España) — PVPC oficial
   No API key required for public endpoints
   ============================================================ */

'use strict';

// ─── COLOUR THRESHOLDS (€/MWh) ────────────────────────────────────────────────
const THRESHOLD_CHEAP = 80;
const THRESHOLD_MID   = 150;

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  todayPrices:    [],   // [{hour, price}]
  tomorrowPrices: [],
  activeTab:      'today',
  alarm: {
    active:    false,
    threshold: null,
    triggered: false,
    intervalId: null,
    audioCtx:  null,
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function tier(price) {
  if (price < THRESHOLD_CHEAP) return 'cheap';
  if (price < THRESHOLD_MID)   return 'mid';
  return 'exp';
}

function tierColor(price) {
  const t = tier(price);
  if (t === 'cheap') return getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
  if (t === 'mid')   return getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();
  return getComputedStyle(document.documentElement).getPropertyValue('--red').trim();
}

function tierLabel(price) {
  const t = tier(price);
  if (t === 'cheap') return '⚡ Precio Barato';
  if (t === 'mid')   return '〰 Precio Medio';
  return '🔥 Precio Caro';
}

function fmt(price) {
  return price != null ? price.toFixed(2) : '--';
}

function fmtHour(h) {
  return `${String(h).padStart(2,'0')}:00`;
}

// Interpolate color between green→amber→red based on 0–1 value
function priceGradientColor(normalized) {
  // 0 = green, 0.5 = amber, 1 = red
  const colors = [
    [0, 229, 160],   // green
    [255, 215, 0],   // amber
    [255, 82,  82],  // red
  ];
  let r, g, b;
  if (normalized <= 0.5) {
    const t = normalized * 2;
    r = lerp(colors[0][0], colors[1][0], t);
    g = lerp(colors[0][1], colors[1][1], t);
    b = lerp(colors[0][2], colors[1][2], t);
  } else {
    const t = (normalized - 0.5) * 2;
    r = lerp(colors[1][0], colors[2][0], t);
    g = lerp(colors[1][1], colors[2][1], t);
    b = lerp(colors[1][2], colors[2][2], t);
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function normalizePrice(price, prices) {
  const min = Math.min(...prices.map(p => p.price));
  const max = Math.max(...prices.map(p => p.price));
  if (max === min) return 0.5;
  return (price - min) / (max - min);
}

// ─── API: ESIOS PVPC ──────────────────────────────────────────────────────────
// ESIOS has a public API. PVPC prices are on indicator 1001.
// We use the open endpoint that doesn't need an API key.

async function fetchESIOSPrices(dateStr) {
  // Primary: try ESIOS public API for PVPC (indicator 1001)
  const url = `https://api.esios.ree.es/indicators/1001?locale=es&start_date=${dateStr}T00:00:00Z&end_date=${dateStr}T23:59:59Z&geo_ids[]=8741`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json; application/vnd.esios-api-v1+json',
        'Content-Type': 'application/json',
        'Host': 'api.esios.ree.es',
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Parse the values array
    const values = data?.indicator?.values || [];
    if (values.length === 0) return null;

    const prices = values
      .filter(v => v.geo_id === 8741 || v.geo_name?.toLowerCase().includes('peninsul'))
      .map(v => {
        const dt = new Date(v.datetime || v.date);
        return {
          hour:  dt.getHours(),
          price: parseFloat(v.value), // €/MWh
          datetime: dt,
        };
      })
      .sort((a, b) => a.hour - b.hour);

    return prices.length > 0 ? prices : null;

  } catch (err) {
    console.warn('ESIOS API error:', err);
    return null;
  }
}

// Fallback: use PVPC from REData (Red Eléctrica API, no auth required)
async function fetchREDataPrices(dateStr) {
  const url = `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${dateStr}T00:00&end_date=${dateStr}T23:59&time_trunc=hour`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Find PVPC or spot price
    const included = data?.included || [];
    const pvpcGroup = included.find(d =>
      d?.attributes?.title?.toLowerCase().includes('pvpc') ||
      d?.attributes?.title?.toLowerCase().includes('spot') ||
      d?.id === '1' || d?.id === '600'
    ) || included[0];

    if (!pvpcGroup) return null;

    const values = pvpcGroup?.attributes?.values || [];
    return values.map(v => {
      const dt = new Date(v.datetime);
      return {
        hour:  dt.getHours(),
        price: parseFloat(v.value), // already €/MWh
        datetime: dt,
      };
    }).sort((a, b) => a.hour - b.hour);

  } catch (err) {
    console.warn('REData API error:', err);
    return null;
  }
}

// Demo/fallback prices (realistic 2024 Spanish PVPC pattern)
function generateDemoPrices(dateStr, seed = 0) {
  // Realistic hourly PVPC pattern (€/MWh) for Spain
  const basePattern = [
    52, 48, 45, 43, 42, 48, 72, 105, 140, 155, 145, 130,
    118, 112, 108, 115, 135, 165, 175, 168, 150, 130, 100, 70
  ];
  const noise = seed * 12;
  return basePattern.map((p, h) => ({
    hour: h,
    price: Math.max(20, p + (Math.random() - 0.5) * 20 + noise),
    datetime: new Date(`${dateStr}T${String(h).padStart(2,'0')}:00:00`),
  }));
}

async function loadPrices() {
  const today    = getTodayStr();
  const tomorrow = getTomorrowStr();

  // Try all sources
  let todayData = await fetchREDataPrices(today);
  if (!todayData || todayData.length === 0) {
    todayData = await fetchESIOSPrices(today);
  }
  if (!todayData || todayData.length === 0) {
    console.info('Using demo data for today');
    todayData = generateDemoPrices(today, 0);
    showDemoBanner();
  }

  let tomorrowData = await fetchREDataPrices(tomorrow);
  if (!tomorrowData || tomorrowData.length === 0) {
    tomorrowData = await fetchESIOSPrices(tomorrow);
  }
  // Tomorrow might not be available yet
  if (tomorrowData && tomorrowData.length > 0) {
    state.tomorrowPrices = tomorrowData;
    document.querySelector('[data-tab="tomorrow"]').textContent = 'Mañana ✓';
  } else {
    state.tomorrowPrices = [];
    document.querySelector('[data-tab="tomorrow"]').textContent = 'Mañana (sin datos aún)';
  }

  state.todayPrices = todayData;
  return true;
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function showDemoBanner() {
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.innerHTML = '⚠️ La API de ESIOS/REData no está accesible desde este entorno (CORS). Mostrando datos de ejemplo realistas del PVPC. En producción (servidor propio), la conexión funciona directamente. <a href="https://www.esios.ree.es/es/pvpc" target="_blank">Ver datos reales →</a>';
  document.querySelector('.tab-nav').after(banner);
}

// ─── LIVE CLOCK ───────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('liveClock').textContent =
    now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('dateDisplay').textContent =
    now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── CURRENT PRICE ────────────────────────────────────────────────────────────
function updateCurrentPrice() {
  const now   = new Date();
  const hour  = now.getHours();
  const entry = state.todayPrices.find(p => p.hour === hour);

  if (!entry) return;

  const card  = document.getElementById('currentPriceCard');
  const price = entry.price;
  const t     = tier(price);

  document.getElementById('currentPrice').textContent    = fmt(price);
  document.getElementById('currentPriceKwh').textContent = `${(price / 1000).toFixed(4)} €/kWh`;
  document.getElementById('currentTierBadge').textContent = tierLabel(price);
  document.getElementById('currentHourLabel').textContent = `Tramo ${fmtHour(hour)} – ${fmtHour(hour + 1)}`;

  card.className = `current-price-card tier-${t}`;
  document.title = `${fmt(price)} €/MWh · LuzHoy`;

  // Check alarm
  checkAlarm(price);
}

// ─── STAT CARDS ───────────────────────────────────────────────────────────────
function updateStats(prices) {
  if (!prices.length) return;
  const vals   = prices.map(p => p.price);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const avgVal = vals.reduce((s, v) => s + v, 0) / vals.length;

  const minEntry = prices.find(p => p.price === minVal);
  const maxEntry = prices.find(p => p.price === maxVal);

  document.getElementById('minPrice').textContent = fmt(minVal);
  document.getElementById('maxPrice').textContent = fmt(maxVal);
  document.getElementById('avgPrice').textContent = fmt(avgVal);
  document.getElementById('minHour').textContent  = minEntry ? fmtHour(minEntry.hour) : '--';
  document.getElementById('maxHour').textContent  = maxEntry ? fmtHour(maxEntry.hour) : '--';
}

// ─── RADIAL CLOCK ─────────────────────────────────────────────────────────────
function drawRadialClock(prices) {
  const canvas = document.getElementById('radialClock');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const outerR = W * 0.45;
  const innerR = W * 0.27;

  ctx.clearRect(0, 0, W, H);

  if (!prices.length) return;

  const total = 24;
  const sliceAngle = (Math.PI * 2) / total;
  const startOffset = -Math.PI / 2; // start at top

  prices.forEach(({ hour, price }) => {
    const startAngle = startOffset + hour * sliceAngle;
    const endAngle   = startAngle + sliceAngle - 0.01;
    const n          = normalizePrice(price, prices);
    const color      = priceGradientColor(n);
    const isCurrentHour = hour === new Date().getHours();

    // Main arc
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = isCurrentHour ? 1 : 0.75;
    ctx.fill();

    // Glow for current hour
    if (isCurrentHour) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });

  ctx.globalAlpha = 1;

  // Inner circle (hole)
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#151E2E';
  ctx.fill();

  // Hour labels
  ctx.font = '600 10px Space Grotesk, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  [0, 6, 12, 18].forEach(h => {
    const angle = startOffset + h * sliceAngle + sliceAngle / 2;
    const labelR = outerR + 16;
    const x = cx + Math.cos(angle) * labelR;
    const y = cy + Math.sin(angle) * labelR;
    ctx.fillStyle = '#8B96AA';
    ctx.fillText(String(h).padStart(2,'0'), x, y);
  });

  // Center: current price
  const currentEntry = prices.find(p => p.hour === new Date().getHours());
  if (currentEntry) {
    ctx.fillStyle = '#E8EDF5';
    ctx.font = '700 22px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(currentEntry.price), cx, cy - 8);
    ctx.fillStyle = '#8B96AA';
    ctx.font = '400 10px Inter, sans-serif';
    ctx.fillText('€/MWh', cx, cy + 12);
  }

  // Clock hand
  const now = new Date();
  const clockAngle = startOffset + (now.getHours() + now.getMinutes() / 60) * sliceAngle;
  const handLen    = innerR - 10;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(clockAngle) * handLen, cy + Math.sin(clockAngle) * handLen);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// ─── BAR CHART ────────────────────────────────────────────────────────────────
let hoveredHour = null;

function drawBarChart(prices) {
  const canvas = document.getElementById('barChart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const padLeft = 52, padRight = 20, padTop = 30, padBottom = 38;
  const chartW  = W - padLeft - padRight;
  const chartH  = H - padTop - padBottom;

  ctx.clearRect(0, 0, W, H);

  if (!prices.length) {
    ctx.fillStyle = '#8B96AA';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos disponibles para mañana aún.', W / 2, H / 2);
    return;
  }

  const vals   = prices.map(p => p.price);
  const minVal = 0;
  const maxVal = Math.max(...vals) * 1.12;
  const n      = prices.length;
  const barW   = chartW / n;
  const barGap = barW * 0.15;

  // Grid lines
  const gridCount = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridCount; i++) {
    const y = padTop + chartH - (i / gridCount) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + chartW, y);
    ctx.stroke();

    const label = ((maxVal * i) / gridCount).toFixed(0);
    ctx.fillStyle = '#8B96AA';
    ctx.font = '10px Space Grotesk, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(label, padLeft - 6, y + 3);
  }

  // Y axis label
  ctx.save();
  ctx.translate(10, padTop + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#8B96AA';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('€/MWh', 0, 0);
  ctx.restore();

  // Bars
  const currentHour = new Date().getHours();

  prices.forEach(({ hour, price }) => {
    const x    = padLeft + hour * barW + barGap / 2;
    const bw   = barW - barGap;
    const norm = (price - minVal) / (maxVal - minVal);
    const bh   = norm * chartH;
    const y    = padTop + chartH - bh;
    const n    = normalizePrice(price, prices);
    const col  = priceGradientColor(n);

    const isHovered  = hoveredHour === hour;
    const isCurrent  = state.activeTab === 'today' && hour === currentHour;

    // Bar shadow / highlight
    if (isHovered || isCurrent) {
      ctx.shadowColor = col;
      ctx.shadowBlur  = 14;
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(x, y, x, padTop + chartH);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col.replace('rgb', 'rgba').replace(')', ',0.2)'));

    ctx.fillStyle = grad;
    ctx.globalAlpha = isHovered ? 1 : (isCurrent ? 1 : 0.82);

    // Rounded top
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, padTop + chartH);
    ctx.lineTo(x, padTop + chartH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Current hour indicator
    if (isCurrent) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + bw / 2, y - 8, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hour labels
    if (n % 2 === 0 || prices.length <= 24) {
      ctx.fillStyle = isCurrent ? '#E8EDF5' : '#8B96AA';
      ctx.font = isCurrent ? '600 9px Space Grotesk' : '400 9px Space Grotesk';
      ctx.textAlign = 'center';
      ctx.fillText(String(hour).padStart(2,'0'), x + bw / 2, padTop + chartH + 14);
    }
  });

  // Price tag on hover
  if (hoveredHour !== null) {
    const entry = prices.find(p => p.hour === hoveredHour);
    if (entry) {
      const x   = padLeft + hoveredHour * barW + barW / 2;
      const n   = normalizePrice(entry.price, prices);
      const col = priceGradientColor(n);
      const bh  = ((entry.price - minVal) / (maxVal - minVal)) * chartH;
      const y   = padTop + chartH - bh - 20;

      ctx.fillStyle = col;
      ctx.font = '700 12px Space Grotesk, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${fmt(entry.price)}`, x, y);
    }
  }
}

function bindBarChartEvents() {
  const canvas = document.getElementById('barChart');
  const prices  = () => state.activeTab === 'today' ? state.todayPrices : state.tomorrowPrices;

  canvas.addEventListener('mousemove', e => {
    const rect  = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const mx    = (e.clientX - rect.left) * scaleX;
    const padL  = 52;
    const chartW = canvas.width - padL - 20;
    const ps    = prices();
    if (!ps.length) return;
    const barW = chartW / ps.length;
    const hovered = Math.floor((mx - padL) / barW);
    if (hovered >= 0 && hovered < ps.length) {
      hoveredHour = ps[hovered].hour;
      const entry = ps[hovered];
      showTooltip(entry.hour, entry.price);
      drawBarChart(ps);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredHour = null;
    hideTooltip();
    drawBarChart(prices());
  });
}

function showTooltip(hour, price) {
  const box = document.getElementById('tooltipBox');
  const n   = normalizePrice(price, state.activeTab === 'today' ? state.todayPrices : state.tomorrowPrices);
  const col = priceGradientColor(n);
  box.style.display = 'inline-block';
  box.style.borderColor = col + '44';
  document.getElementById('ttHour').textContent  = `${fmtHour(hour)} – ${fmtHour(hour + 1)}`;
  document.getElementById('ttPrice').textContent = `${fmt(price)} €/MWh  ·  ${(price/1000).toFixed(4)} €/kWh`;
  document.getElementById('ttPrice').style.color = col;
  document.getElementById('ttTier').textContent  = tierLabel(price);
  document.getElementById('ttTier').style.color  = col;
}

function hideTooltip() {
  document.getElementById('tooltipBox').style.display = 'none';
}

// ─── HEATMAP ──────────────────────────────────────────────────────────────────
function renderHeatmap(prices) {
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  const currentHour = new Date().getHours();

  prices.forEach(({ hour, price }) => {
    const n    = normalizePrice(price, prices);
    const col  = priceGradientColor(n);
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell' + (hour === currentHour && state.activeTab === 'today' ? ' current-hour' : '');
    cell.style.background = col;
    cell.title = `${fmtHour(hour)}: ${fmt(price)} €/MWh`;
    cell.addEventListener('click', () => showTooltip(hour, price));
    grid.appendChild(cell);
  });
}

// ─── BEST WINDOWS ─────────────────────────────────────────────────────────────
function renderBestWindows(prices) {
  const list = document.getElementById('windowsList');
  if (!prices.length) {
    list.innerHTML = '<div class="loading-msg">Sin datos disponibles</div>';
    return;
  }

  // Find best 3 cheap windows of 2-3 hours
  const avgPrice = prices.reduce((s, p) => s + p.price, 0) / prices.length;
  const windows  = [];

  // Simple sliding window of 2h
  for (let i = 0; i < prices.length - 1; i++) {
    const window2h = prices.slice(i, i + 2);
    const avgW     = window2h.reduce((s, p) => s + p.price, 0) / 2;
    windows.push({ start: window2h[0].hour, end: window2h[1].hour, avg: avgW, len: 2 });
  }
  // Sort by avg price
  windows.sort((a, b) => a.avg - b.avg);

  // Deduplicate overlapping windows
  const best = [];
  const usedHours = new Set();
  for (const w of windows) {
    if (best.length >= 3) break;
    const hrs = [];
    for (let h = w.start; h <= w.end; h++) hrs.push(h);
    if (!hrs.some(h => usedHours.has(h))) {
      best.push(w);
      hrs.forEach(h => usedHours.add(h));
    }
  }

  list.innerHTML = '';
  best.forEach((w, i) => {
    const saving = ((avgPrice - w.avg) / avgPrice * 100).toFixed(0);
    const item = document.createElement('div');
    item.className = 'window-item';
    const rankClass = i === 0 ? '' : i === 1 ? ' rank-2' : ' rank-3';
    item.innerHTML = `
      <div class="window-rank${rankClass}">${i + 1}</div>
      <div class="window-info">
        <div class="window-hours">${fmtHour(w.start)} – ${fmtHour(w.end + 1)}</div>
        <div class="window-price">Media: ${fmt(w.avg)} €/MWh</div>
      </div>
      <div class="window-saving">${saving > 0 ? '−' + saving + '%' : 'Mejor'}</div>
    `;
    list.appendChild(item);
  });
}

// ─── GAUGE ────────────────────────────────────────────────────────────────────
function drawGauge(prices) {
  const canvas = document.getElementById('gaugeChart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const currentHour  = new Date().getHours();
  const currentEntry = prices.find(p => p.hour === currentHour) || prices[prices.length - 1];
  if (!currentEntry) return;

  const n    = normalizePrice(currentEntry.price, prices);
  const col  = priceGradientColor(n);

  const cx = W / 2, cy = H - 20;
  const R  = Math.min(W, H * 1.8) * 0.45;

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 0, false);
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Colored arc
  const endAngle = Math.PI + n * Math.PI;
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, endAngle, false);
  ctx.lineWidth = 18;
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur  = 12;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Labels
  ctx.fillStyle = '#8B96AA';
  ctx.font = '10px Space Grotesk, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Min', cx - R - 2, cy + 16);
  ctx.textAlign = 'right';
  ctx.fillText('Max', cx + R + 2, cy + 16);

  // Needle
  const needleAngle = Math.PI + n * Math.PI;
  const nx = cx + Math.cos(needleAngle) * (R - 24);
  const ny = cy + Math.sin(needleAngle) * (R - 24);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = '#E8EDF5';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#E8EDF5';
  ctx.fill();

  // Update labels
  const percentile = Math.round(n * 100);
  document.getElementById('gaugeLabel').textContent = `${fmt(currentEntry.price)} €/MWh`;
  document.getElementById('gaugeLabel').style.color = col;
  document.getElementById('percentileText').textContent = `Percentil ${percentile} hoy`;
}

// ─── ALARM ────────────────────────────────────────────────────────────────────
function initAlarm() {
  const btn    = document.getElementById('alarmBtn');
  const input  = document.getElementById('alarmThreshold');
  const status = document.getElementById('alarmStatus');

  btn.addEventListener('click', () => {
    if (state.alarm.active) {
      // Deactivate
      state.alarm.active    = false;
      state.alarm.threshold = null;
      state.alarm.triggered = false;
      btn.classList.remove('active');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg> Activar`;
      status.textContent = 'Sin alarma activa';
    } else {
      const val = parseFloat(input.value);
      if (!val || isNaN(val)) {
        input.focus();
        input.style.borderColor = 'var(--red)';
        setTimeout(() => input.style.borderColor = '', 1500);
        return;
      }
      state.alarm.active    = true;
      state.alarm.threshold = val;
      state.alarm.triggered = false;
      btn.classList.add('active');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg> Desactivar`;
      status.textContent = `Alerta cuando precio < ${val} €/MWh`;
    }
  });
}

function checkAlarm(currentPrice) {
  if (!state.alarm.active || state.alarm.threshold === null) return;
  if (currentPrice < state.alarm.threshold) {
    if (!state.alarm.triggered) {
      state.alarm.triggered = true;
      triggerAlarm(currentPrice);
    }
  } else {
    state.alarm.triggered = false;
  }
}

function triggerAlarm(price) {
  // Visual toast
  const toast = document.getElementById('alarmToast');
  document.getElementById('toastMsg').textContent = `Precio actual: ${fmt(price)} €/MWh — ¡Enchufa ya!`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 8000);

  // Vibrate (mobile)
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  // Audio beep via Web Audio API
  playAlarmSound();

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('⚡ LuzHoy — Precio Barato', {
      body: `El precio es ${fmt(price)} €/MWh. ¡Buen momento para consumir!`,
      icon: 'data:image/svg+xml,...'
    });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') triggerAlarm(price);
    });
  }
}

function playAlarmSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    beep(523, 0,    0.2);
    beep(659, 0.25, 0.2);
    beep(784, 0.5,  0.4);
  } catch (e) {
    // Audio not available
  }
}

window.dismissToast = function() {
  document.getElementById('alarmToast').classList.remove('show');
};

// ─── TABS ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const prices = state.activeTab === 'today' ? state.todayPrices : state.tomorrowPrices;
      const label  = state.activeTab === 'today'
        ? `Tarifas por hora — Hoy (${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })})`
        : `Tarifas por hora — Mañana (${new Date(Date.now()+86400000).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })})`;
      document.getElementById('chartTitle').textContent = label;

      hoveredHour = null;
      drawBarChart(prices);
      renderHeatmap(prices);
      renderBestWindows(prices);
      updateStats(prices);
      if (state.activeTab === 'today') {
        drawGauge(state.todayPrices);
      } else {
        drawGauge(prices);
      }
    });
  });
}

// ─── RESIZE ───────────────────────────────────────────────────────────────────
function resizeCanvases() {
  const barWrapper = document.querySelector('.bar-chart-wrapper');
  const barCanvas  = document.getElementById('barChart');
  const w = Math.max(barWrapper.clientWidth - 4, 800);
  if (barCanvas.width !== w) {
    barCanvas.width = w;
    drawBarChart(state.activeTab === 'today' ? state.todayPrices : state.tomorrowPrices);
  }

  const clockCard   = document.querySelector('.clock-card');
  const clockCanvas = document.getElementById('radialClock');
  const cs = Math.min(clockCard.clientWidth - 48, 320);
  if (clockCanvas.width !== cs) {
    clockCanvas.width  = cs;
    clockCanvas.height = cs;
    drawRadialClock(state.todayPrices);
  }
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────
function renderAll() {
  updateCurrentPrice();
  updateStats(state.todayPrices);
  drawRadialClock(state.todayPrices);
  drawBarChart(state.todayPrices);
  renderHeatmap(state.todayPrices);
  renderBestWindows(state.todayPrices);
  drawGauge(state.todayPrices);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function init() {
  // Start clock immediately
  updateClock();
  setInterval(updateClock, 1000);

  // Init UI
  initTabs();
  initAlarm();
  bindBarChartEvents();

  // Load data
  await loadPrices();

  // Render everything
  renderAll();

  // Resize handling
  window.addEventListener('resize', () => {
    clearTimeout(window._resizeTimer);
    window._resizeTimer = setTimeout(resizeCanvases, 150);
  });
  setTimeout(resizeCanvases, 100);

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    await loadPrices();
    renderAll();
  }, 5 * 60 * 1000);

  // Re-draw clock and current price every minute
  setInterval(() => {
    updateCurrentPrice();
    drawRadialClock(state.todayPrices);
  }, 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
