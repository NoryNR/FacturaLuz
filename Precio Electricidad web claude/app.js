/* ============================================================
   LuzHoy — Main Application v2
   Fixes: kWh display, bar chart full width, radial donut,
   new consumption planner widget
   ============================================================ */
'use strict';

// ─── DYNAMIC THRESHOLDS ──────────────────────────────────────────────────────
// Fallback defaults when no data is available yet
const THRESHOLD_CHEAP = 80;  // €/MWh
const THRESHOLD_MID   = 150; // €/MWh

// Percentile-based thresholds that adapt to daily price volatility
function calculateThresholds(prices) {
  if (!prices?.length) return { cheap: THRESHOLD_CHEAP, mid: THRESHOLD_MID };
  const sorted = [...prices].map(p => p.price).sort((a, b) => a - b);
  const p30 = sorted[Math.floor(sorted.length * 0.30)];
  const p70 = sorted[Math.floor(sorted.length * 0.70)];
  return {
    cheap: Math.max(p30, 30),   // minimum floor 30 €/MWh
    mid:   Math.min(p70, 300),  // maximum ceiling 300 €/MWh
  };
}

function getThresholdCheap(prices) {
  return calculateThresholds(prices || activePrices()).cheap;
}

function getThresholdMid(prices) {
  return calculateThresholds(prices || activePrices()).mid;
}

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  todayPrices:    [],
  tomorrowPrices: [],
  historyPrices:  [],
  historyDayData: [], // [{ dateStr, date, min, max, avg, minHour, maxHour, prices[] }]
  comparePrices:  [], // selected day's prices [{ hour, price, datetime }] for the compare tab
  compareDate:    '', // selected date string (YYYY-MM-DD) for the compare tab
  loadedDayStr:   '', // local YYYY-MM-DD the prices were loaded for (midnight-rollover guard)
  activeTab:      'today',
  chartMode:      'bars', // 'bars' | 'wave' — hourly tariff chart visual mode
  chartSelIdx:    null,    // pinned bar index in the tariff chart, null = none
  alarm: { active: false, threshold: null, triggered: false },
  // Slot widget — prefix "slot" to avoid collisions
  slotDuration: 2,    // hours (1–24)
  slotPower:    2000, // watts (positive)
  slotError:    '',   // active validation error message, empty when none
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function tier(price) {
  if (price < getThresholdCheap()) return 'cheap';
  if (price < getThresholdMid())   return 'mid';
  return 'exp';
}
function tierLabel(price) {
  const t = tier(price);
  if (t === 'cheap') return '⚡ Precio Barato';
  if (t === 'mid')   return '〰 Precio Medio';
  return '🔥 Precio Caro';
}
// Format €/MWh
function fmtMWh(price) { return price != null ? price.toFixed(2) : '--'; }
// Format €/kWh  e.g. 0,21627
function fmtKwh(price) {
  if (price == null) return '--';
  return (price / 1000).toLocaleString('es-ES', { minimumFractionDigits: 5, maximumFractionDigits: 5 }) + ' €/kWh';
}
// Short kWh for labels
function fmtKwhShort(price) {
  if (price == null) return '--';
  return (price / 1000).toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function fmtHour(h) { return `${String(h).padStart(2,'0')}:00`; }
function fmtDuration(hours) {
  // Format decimal hours as "Xh Ym" or just "Xh" if no minutes
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function lerp(a, b, t) { return a + (b - a) * t; }

function priceGradientColor(normalized) {
  const c = [[0,229,160],[255,215,0],[255,82,82]];
  let r, g, b;
  if (normalized <= 0.5) {
    const t = normalized * 2;
    r = lerp(c[0][0],c[1][0],t); g = lerp(c[0][1],c[1][1],t); b = lerp(c[0][2],c[1][2],t);
  } else {
    const t = (normalized - 0.5) * 2;
    r = lerp(c[1][0],c[2][0],t); g = lerp(c[1][1],c[2][1],t); b = lerp(c[1][2],c[2][2],t);
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function normalizedPrice(price) {
  // Dynamic thresholds for "Precio Ahora" badge — consistent with tier()
  const cheap = getThresholdCheap();
  const mid   = getThresholdMid();
  if (price <= cheap) return 0;
  if (price >= mid)   return 1;
  return (price - cheap) / (mid - cheap);
}

function normalizePrice(price, pricesArr) {
  // Normalización basada en rango del día para más variación de colores en gráficos
  const arr = pricesArr || activePrices();
  if (!arr?.length) return 0.5;
  const min = Math.min(...arr.map(p => p.price));
  const max = Math.max(...arr.map(p => p.price));
  if (max === min) return 0.5;
  return (price - min) / (max - min);
}

function activePrices() {
  return state.activeTab === 'today' ? state.todayPrices : state.tomorrowPrices;
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function fetchREDataPrices(dateStr) {
  const url = `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${dateStr}T00:00&end_date=${dateStr}T23:59&time_trunc=hour`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const included = data?.included || [];
    const grp = included.find(d =>
      d?.attributes?.title?.toLowerCase().includes('pvpc') ||
      d?.attributes?.title?.toLowerCase().includes('spot') ||
      d?.id === '1' || d?.id === '600'
    ) || included[0];
    if (!grp) return null;
    const values = grp?.attributes?.values || [];
    return values.map(v => {
      const dt = new Date(v.datetime);
      return { hour: dt.getHours(), price: parseFloat(v.value), datetime: dt };
    }).sort((a, b) => a.hour - b.hour);
  } catch (e) { console.warn('REData error:', e); return null; }
}

async function fetchESIOSPrices(dateStr) {
  const url = `https://api.esios.ree.es/indicators/1001?locale=es&start_date=${dateStr}T00:00:00Z&end_date=${dateStr}T23:59:59Z&geo_ids[]=8741`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json; application/vnd.esios-api-v1+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const values = data?.indicator?.values || [];
    if (!values.length) return null;
    return values
      .filter(v => v.geo_id === 8741 || v.geo_name?.toLowerCase().includes('peninsul'))
      .map(v => { const dt = new Date(v.datetime || v.date); return { hour: dt.getHours(), price: parseFloat(v.value), datetime: dt }; })
      .sort((a,b) => a.hour - b.hour);
  } catch (e) { console.warn('ESIOS error:', e); return null; }
}

function generateDemoPrices(dateStr, seed = 0) {
  const base = [52,48,45,43,42,48,72,105,140,155,145,130,118,112,108,115,135,165,175,168,150,130,100,70];
  const noise = seed * 12;
  // Use seeded random for reproducibility
  let s = seed + 1;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return base.map((p, h) => ({
    hour: h,
    price: Math.max(20, p + (rng() - 0.5) * 20 + noise),
    datetime: new Date(`${dateStr}T${String(h).padStart(2,'0')}:00:00`),
  }));
}

let demoBannerShown = false;
function showDemoBanner() {
  if (demoBannerShown) return;
  demoBannerShown = true;
  const b = document.createElement('div');
  b.className = 'error-banner';
  b.innerHTML = '⚠️ API de ESIOS/REData no accesible desde este entorno (CORS). Mostrando datos de ejemplo realistas del PVPC. En producción con servidor propio la conexión funciona directamente. <a href="https://www.esios.ree.es/es/pvpc" target="_blank">Ver datos reales →</a>';
  document.querySelector('.tab-nav').after(b);
}

async function loadPrices() {
  const today    = getTodayStr();
  const tomorrow = getTomorrowStr();

  let todayData = await fetchREDataPrices(today);
  if (!todayData?.length) todayData = await fetchESIOSPrices(today);
  if (!todayData?.length) { todayData = generateDemoPrices(today, 0); showDemoBanner(); }

  let tomorrowData = await fetchREDataPrices(tomorrow);
  if (!tomorrowData?.length) tomorrowData = await fetchESIOSPrices(tomorrow);
  // If still no tomorrow data, generate demo for tomorrow
  if (!tomorrowData?.length) {
    tomorrowData = generateDemoPrices(tomorrow, 1);
    document.querySelector('[data-tab="tomorrow"]').textContent = 'Mañana (demo)';
  } else {
    document.querySelector('[data-tab="tomorrow"]').textContent = 'Mañana ✓';
  }

  state.todayPrices    = todayData;
  state.tomorrowPrices = tomorrowData;
  state.loadedDayStr   = today;
  return true;
}

async function loadHistoryDate(dateStr) {
  let data = await fetchREDataPrices(dateStr);
  if (!data?.length) data = await fetchESIOSPrices(dateStr);
  if (!data?.length) {
    // Generar datos demo si no hay acceso a API
    const seed = dateStr.split('-').reduce((a, b) => a + parseInt(b), 0);
    data = generateDemoPrices(dateStr, seed + 100);
  }
  return data;
}

// Local YYYY-MM-DD (NOT UTC). Using toISOString() rolls the date over at midnight
// UTC, so between 00:00 and ~02:00 local time "today" wrongly resolved to the
// previous day. getHours()/getDate() are local, so the date string must be too.
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getTodayStr()    { return toLocalDateStr(new Date()); }
function getTomorrowStr() { const d = new Date(); d.setDate(d.getDate()+1); return toLocalDateStr(d); }

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('liveClock').textContent =
    now.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.getElementById('dateDisplay').textContent =
    now.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}

// ─── CURRENT PRICE ───────────────────────────────────────────────────────────
function updateCurrentPrice() {
  const hour  = new Date().getHours();
  const entry = state.todayPrices.find(p => p.hour === hour);
  if (!entry) return;
  const price = entry.price;
  // Título de la página
  document.title = `${fmtKwhShort(price)} €/kWh · LuzHoy`;
}

// ─── STAT CARDS ──────────────────────────────────────────────────────────────
function updateStats(prices) {
  if (!prices.length) return;
  const vals   = prices.map(p => p.price);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const avgVal = vals.reduce((s,v)=>s+v,0) / vals.length;
  const minEntry = prices.find(p => p.price === minVal);
  const maxEntry = prices.find(p => p.price === maxVal);
  // Show as €/kWh
  document.getElementById('minPrice').textContent = fmtKwhShort(minVal);
  document.getElementById('maxPrice').textContent = fmtKwhShort(maxVal);
  document.getElementById('avgPrice').textContent = fmtKwhShort(avgVal);
  document.getElementById('minHour').textContent  = minEntry ? fmtHour(minEntry.hour) : '--';
  document.getElementById('maxHour').textContent  = maxEntry ? fmtHour(maxEntry.hour) : '--';
}

// ─── HI-DPI CANVAS HELPERS ───────────────────────────────────────────────────
// Size a canvas backing store for crisp rendering at a CSS-pixel box, returning
// a 2D context whose coordinate space is CSS pixels (so drawing code stays simple).
function prepCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Tariff bar-chart paddings / label density adapt to width so all 24 hours stay
// legible on narrow phone screens without horizontal scrolling.
function barChartMetrics(cssW) {
  const compact = cssW < 520;
  let labelEvery = 1;
  if (cssW < 360) labelEvery = 3;
  else if (compact) labelEvery = 2;
  return {
    padL: compact ? 40 : 54,
    padR: compact ? 12 : 18,
    padT: compact ? 34 : 40,
    padB: compact ? 30 : 38,
    compact,
    labelEvery,
    axisPx: compact ? 8 : 9,
    pillFont: compact ? '700 8px Space Grotesk, sans-serif' : '700 9px Space Grotesk, sans-serif',
    hoverFont: compact ? '700 10px Space Grotesk, sans-serif' : '700 11px Space Grotesk, sans-serif',
  };
}

// ─── RADIAL DONUT CLOCK ──────────────────────────────────────────────────────
// Fixed: use arc strokes (donut style) instead of filled pie slices
function drawRadialClock(prices) {
  const canvas = document.getElementById('radialClock');
  if (!canvas) return;
  const host  = canvas.parentElement;
  const avail = host ? host.clientWidth : 320;
  const size  = Math.max(220, Math.min(avail, 340));
  const ctx   = prepCanvas(canvas, size, size);
  const W = size, H = size;
  const cx = W / 2, cy = H / 2;
  const outerR  = W * 0.44;
  const innerR  = W * 0.28;
  const ringW   = outerR - innerR;
  const midR    = innerR + ringW / 2;

  ctx.clearRect(0, 0, W, H);
  if (!prices.length) return;

  const total      = 24;
  const sliceAngle = (Math.PI * 2) / total;
  const startOff   = -Math.PI / 2 - sliceAngle / 2; // centro del slot 00 en las 12 en punto
  const gap        = 0.04; // radians gap between slices
  const currentHour = new Date().getHours();

  prices.forEach(({ hour, price }) => {
    const aStart = startOff + hour * sliceAngle + gap / 2;
    const aEnd   = startOff + (hour + 1) * sliceAngle - gap / 2;
    const n = normalizePrice(price, prices);
    const color  = priceGradientColor(n);
    const isCur  = hour === currentHour;

    // Draw arc ring segment
    ctx.beginPath();
    ctx.arc(cx, cy, midR, aStart, aEnd);
    ctx.lineWidth   = ringW * (isCur ? 1.15 : 0.92);
    ctx.strokeStyle = color;
    ctx.lineCap     = 'butt';
    ctx.globalAlpha = isCur ? 1 : 0.78;

    if (isCur) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 16;
    }
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  });

  // White ring outline for current hour (extra highlight)
  const curEntry = prices.find(p => p.hour === currentHour);
  if (curEntry) {
    const aStart = startOff + currentHour * sliceAngle + gap / 2;
    const aEnd   = startOff + (currentHour + 1) * sliceAngle - gap / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, midR, aStart, aEnd);
    ctx.lineWidth   = ringW * 1.15 + 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineCap     = 'butt';
    ctx.stroke();
    // Draw color on top
    ctx.beginPath();
    ctx.arc(cx, cy, midR, aStart, aEnd);
    ctx.lineWidth   = ringW * 1.15;
    ctx.strokeStyle = priceGradientColor(normalizePrice(curEntry.price, prices));
    ctx.shadowColor = priceGradientColor(normalizePrice(curEntry.price, prices));
    ctx.shadowBlur  = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Hour labels at 0, 6, 12, 18
  ctx.font = '600 10px Space Grotesk, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [0, 6, 12, 18].forEach(h => {
    const angle  = startOff + h * sliceAngle + sliceAngle / 2;
    const labelR = outerR + 14;
    ctx.fillStyle = '#8B96AA';
    ctx.fillText(String(h).padStart(2,'0'),
      cx + Math.cos(angle) * labelR,
      cy + Math.sin(angle) * labelR);
  });

  // Center text: current kWh price
  if (curEntry) {
    const kwhStr  = fmtKwhShort(curEntry.price);
    const col     = priceGradientColor(normalizePrice(curEntry.price, prices));
    ctx.fillStyle = col;
    ctx.font      = '700 18px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(kwhStr, cx, cy - 10);
    ctx.fillStyle = '#8B96AA';
    ctx.font      = '400 10px Inter, sans-serif';
    ctx.fillText('€/kWh', cx, cy + 10);
  }

  // Clock hand
  const now = new Date();
  const clockAngle = startOff + (now.getHours() + now.getMinutes()/60) * sliceAngle;
  const handLen = innerR - 8;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(clockAngle)*handLen, cy + Math.sin(clockAngle)*handLen);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI*2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// ─── BAR CHART ───────────────────────────────────────────────────────────────
// Fixed: use array index for x position, not hour value
let hoveredIdx = null;

const BAR_ANIM_MS = 650;     // entry-animation duration (ms)
let   barAnimId   = null;    // active requestAnimationFrame id

// Build a rounded-rectangle path (optionally only the top two corners).
function roundRectPath(ctx, x, y, w, h, r, topOnly = false) {
  r = Math.max(0, Math.min(r, w / 2, topOnly ? h : h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  if (topOnly) {
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  }
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// "rgb(r,g,b)" → "rgba(r,g,b,a)"
function rgbaFrom(rgb, a) {
  return rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);
}

// Draw a centered rounded "pill" label, clamped within optional [loX, hiX] bounds.
function drawLabelPill(ctx, text, cx, cy, bg, fg, font = '700 9px Space Grotesk, sans-serif', bounds = null) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 14;
  const h = 16;
  let x = cx;
  if (bounds) x = Math.min(Math.max(cx, bounds[0] + w / 2), bounds[1] - w / 2);
  ctx.fillStyle = bg;
  roundRectPath(ctx, x - w / 2, cy - h / 2, w, h, 8);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, cy);
  ctx.textBaseline = 'alphabetic';
}

function drawBarChart(prices, progress = 1) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;
  const host  = canvas.parentElement;
  const cssW  = (host && host.clientWidth > 0) ? host.clientWidth : 800;
  const cssH  = 300;
  const ctx   = prepCanvas(canvas, cssW, cssH);
  const W = cssW, H = cssH;
  const { padL, padR, padT, padB, compact, labelEvery, axisPx, pillFont, hoverFont } = barChartMetrics(W);
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const baseY  = padT + chartH;

  ctx.clearRect(0, 0, W, H);

  if (!prices.length) {
    ctx.fillStyle = '#8B96AA';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos disponibles.', W / 2, H / 2);
    return;
  }

  const vals     = prices.map(p => p.price);
  const minVal   = Math.min(...vals);
  const maxVal   = Math.max(...vals);
  const avgVal   = vals.reduce((s, v) => s + v, 0) / vals.length;
  const maxScale = maxVal * 1.12;
  const barW     = chartW / prices.length;
  const isToday  = state.activeTab === 'today';
  const currentHour = new Date().getHours();
  const hi       = hoveredIdx === null ? state.chartSelIdx : hoveredIdx;
  const yOf      = v => baseY - (v / maxScale) * chartH;

  // Grid + €/kWh axis labels
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = baseY - (i / 5) * chartH;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
    ctx.fillStyle = '#8B96AA';
    ctx.font = `${axisPx}px Space Grotesk, sans-serif`;
    ctx.fillText(((maxScale * i / 5) / 1000).toFixed(3), padL - 6, y + 3);
  }

  const o = { padL, padT, chartH, baseY, barW, maxScale, progress, hi, isToday, currentHour, compact, labelEvery };
  if (state.chartMode === 'wave') drawWaveSeries(ctx, prices, o);
  else                            drawBarSeries(ctx, prices, o);

  // Average reference line
  const avgY = yOf(avgVal);
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(255,215,0,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(padL, avgY); ctx.lineTo(padL + chartW, avgY); ctx.stroke();
  ctx.restore();
  // MEDIA label as a pill anchored to the right end of the line (clear of price tags)
  drawLabelPill(ctx, `MEDIA ${fmtKwhShort(avgVal)} €`, padL + chartW, avgY,
    'rgba(10,14,26,0.8)', '#FFD700', pillFont, [padL, padL + chartW]);

  // Min / Max markers (price baked into the marker label)
  const minIdx = vals.indexOf(minVal);
  const maxIdx = vals.indexOf(maxVal);
  drawExtremeMarker(ctx, prices, minIdx, { padL, chartW, barW, baseY, maxScale, chartH, progress, label: 'MÍN', up: false, color: priceGradientColor(0), font: pillFont });
  drawExtremeMarker(ctx, prices, maxIdx, { padL, chartW, barW, baseY, maxScale, chartH, progress, label: 'MÁX', up: true,  color: priceGradientColor(1), font: pillFont });

  // "Now" indicator (today only) — line centered on the current-hour node/bar
  if (isToday) {
    const ci = prices.findIndex(p => p.hour === currentHour);
    if (ci >= 0) {
      const nx = padL + ci * barW + barW / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(232,237,245,0.45)';
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(nx, padT - 4); ctx.lineTo(nx, baseY); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#00E5A0';
      ctx.beginPath(); ctx.arc(nx, padT - 4, 3, 0, Math.PI * 2); ctx.fill();
      drawLabelPill(ctx, 'AHORA', nx, padT - 14, 'rgba(0,229,160,0.18)', '#00E5A0',
        pillFont, [padL, padL + chartW]);
    }
  }

  // Hover / pinned price tag — skip extremes (shown by the min/max markers)
  if (hi !== null && prices[hi] && hi !== minIdx && hi !== maxIdx) {
    const price = prices[hi].price;
    const xc = padL + hi * barW + barW / 2;
    const col = priceGradientColor(normalizePrice(price, prices));
    drawLabelPill(ctx, `${fmtKwhShort(price)} €`, xc, Math.max(yOf(price) - 14, padT + 8),
      'rgba(10,14,26,0.82)', col, hoverFont, [padL, padL + chartW]);
  }
}

// Animated vertical bars.
function drawBarSeries(ctx, prices, o) {
  const { padL, chartH, baseY, barW, maxScale, progress, hi, isToday, currentHour, compact, labelEvery } = o;
  const lf = compact ? 8 : 9;
  const gap = Math.max(compact ? 1.5 : 2, barW * (compact ? 0.12 : 0.16));
  prices.forEach(({ hour, price }, i) => {
    const x  = padL + i * barW + gap / 2;
    const bw = barW - gap;
    const bh = (price / maxScale) * chartH * progress;
    const y  = baseY - bh;
    const col = priceGradientColor(normalizePrice(price, prices));
    const isHi  = hi === i;
    const isCur = isToday && hour === currentHour;

    if (isHi || isCur) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
    const grad = ctx.createLinearGradient(x, y, x, baseY);
    grad.addColorStop(0, col);
    grad.addColorStop(1, rgbaFrom(col, 0.12));
    ctx.fillStyle = grad;
    let alpha = 0.8;
    if (isHi) alpha = 1;
    else if (isCur) alpha = 0.95;
    ctx.globalAlpha = alpha;
    roundRectPath(ctx, x, y, bw, bh, Math.min(5, bw / 2), true);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (isHi) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      roundRectPath(ctx, x, y, bw, bh, Math.min(5, bw / 2), true);
      ctx.stroke();
    }

    if (!compact || isCur || isHi || i % labelEvery === 0) {
      ctx.fillStyle = (isCur || isHi) ? '#E8EDF5' : '#6B7689';
      ctx.font = (isCur || isHi) ? `600 ${lf}px Space Grotesk` : `400 ${lf}px Space Grotesk`;
      ctx.textAlign = 'center';
      ctx.fillText(String(hour).padStart(2, '0'), x + bw / 2, baseY + (compact ? 12 : 14));
    }
  });
}

// Smooth area + line "wave" with colored hour nodes.
function drawWaveSeries(ctx, prices, o) {
  const { padL, padT, chartH, baseY, barW, maxScale, progress, hi, isToday, currentHour, compact, labelEvery } = o;
  const lf = compact ? 8 : 9;
  const pts = prices.map((p, i) => ({
    x: padL + i * barW + barW / 2,
    y: baseY - (p.price / maxScale) * chartH * progress,
    price: p.price, hour: p.hour, i,
  }));

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y);
    }
  };

  trace();
  ctx.lineTo(pts[pts.length - 1].x, baseY);
  ctx.lineTo(pts[0].x, baseY);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, padT, 0, baseY);
  fill.addColorStop(0, 'rgba(255,82,82,0.32)');   // top = red (expensive peaks)
  fill.addColorStop(0.5, 'rgba(255,215,0,0.16)'); // mid = amber
  fill.addColorStop(1, 'rgba(0,229,160,0.06)');   // bottom = green (near axis)
  ctx.fillStyle = fill;
  ctx.fill();

  trace();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(232,237,245,0.92)';
  ctx.shadowColor = 'rgba(0,229,160,0.45)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  pts.forEach(pt => {
    const col = priceGradientColor(normalizePrice(pt.price, prices));
    const isHi  = hi === pt.i;
    const isCur = isToday && pt.hour === currentHour;
    const rad = (isHi || isCur) ? 5.5 : 3.2;
    if (isHi || isCur) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
    ctx.beginPath(); ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.shadowBlur = 0;
    if (isHi || isCur) {
      ctx.lineWidth = 2; ctx.strokeStyle = '#0A0E1A'; ctx.stroke();
      ctx.beginPath(); ctx.arc(pt.x, pt.y, rad + 3, 0, Math.PI * 2);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (!compact || isCur || isHi || pt.i % labelEvery === 0) {
      ctx.fillStyle = (isCur || isHi) ? '#E8EDF5' : '#6B7689';
      ctx.font = (isCur || isHi) ? `600 ${lf}px Space Grotesk` : `400 ${lf}px Space Grotesk`;
      ctx.textAlign = 'center';
      ctx.fillText(String(pt.hour).padStart(2, '0'), pt.x, baseY + (compact ? 12 : 14));
    }
  });
}

// Triangle + "LABEL · price" pill pinned above the min/max bar top.
function drawExtremeMarker(ctx, prices, idx, o) {
  if (idx < 0) return;
  const { padL, chartW, barW, baseY, maxScale, chartH, progress, label, up, color, font } = o;
  const price = prices[idx].price;
  const xc = padL + idx * barW + barW / 2;
  const yTop = baseY - (price / maxScale) * chartH * progress;
  // Small triangle just above the bar top.
  const tyTri = yTop - 9;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) { ctx.moveTo(xc, tyTri - 5); ctx.lineTo(xc - 4, tyTri + 1); ctx.lineTo(xc + 4, tyTri + 1); }
  else    { ctx.moveTo(xc, tyTri + 5); ctx.lineTo(xc - 4, tyTri - 1); ctx.lineTo(xc + 4, tyTri - 1); }
  ctx.closePath();
  ctx.fill();
  // Label + price above the triangle, clamped inside the plot area.
  drawLabelPill(ctx, `${label} · ${fmtKwhShort(price)} €`, xc, yTop - 24,
    'rgba(10,14,26,0.82)', color, font || '700 9px Space Grotesk, sans-serif', [padL, padL + chartW]);
}

// Entry animation (easeOutCubic): grow from baseline to full height.
function animateBarChart(prices) {
  if (barAnimId) cancelAnimationFrame(barAnimId);
  if (!prices?.length) { drawBarChart(prices, 1); return; }
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / BAR_ANIM_MS);
    drawBarChart(prices, 1 - Math.pow(1 - t, 3));
    barAnimId = t < 1 ? requestAnimationFrame(step) : null;
  };
  barAnimId = requestAnimationFrame(step);
}

function barIndexFromClientX(clientX) {
  const canvas = document.getElementById('barChart');
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;                 // context is scaled to CSS pixels
  const mx = clientX - rect.left;
  const { padL, padR } = barChartMetrics(cssW);
  const ps = activePrices();
  if (!ps.length) return -1;
  const barW = (cssW - padL - padR) / ps.length;
  const idx = Math.floor((mx - padL) / barW);
  return (idx >= 0 && idx < ps.length) ? idx : -1;
}

function bindBarChartEvents() {
  const canvas = document.getElementById('barChart');

  canvas.addEventListener('mousemove', e => {
    const idx = barIndexFromClientX(e.clientX);
    if (idx < 0) return;
    const ps = activePrices();
    hoveredIdx = idx;
    showTooltip(ps[idx].hour, ps[idx].price, ps, e.clientX, e.clientY);
    if (barAnimId) { cancelAnimationFrame(barAnimId); barAnimId = null; }
    drawBarChart(ps, 1);
    updateChartDetail(ps, idx);
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredIdx = null;
    hideTooltip();
    drawBarChart(activePrices(), 1);
    updateChartDetail(activePrices(), state.chartSelIdx);
  });

  canvas.addEventListener('click', e => {
    const idx = barIndexFromClientX(e.clientX);
    if (idx < 0) return;
    state.chartSelIdx = (state.chartSelIdx === idx) ? null : idx;
    syncInsightActive();
    drawBarChart(activePrices(), 1);
    updateChartDetail(activePrices(), state.chartSelIdx);
  });

  canvas.addEventListener('touchstart', e => {
    const idx = barIndexFromClientX(e.touches[0].clientX);
    if (idx < 0) return;
    const ps = activePrices();
    hoveredIdx = idx;
    state.chartSelIdx = idx;
    syncInsightActive();
    drawBarChart(ps, 1);
    updateChartDetail(ps, idx);
  }, { passive: true });
}

// Toggle between bar and wave visual modes.
function initChartModes() {
  const modes = document.getElementById('chartModes');
  if (!modes) return;
  modes.querySelectorAll('.chart-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.chartMode) return;
      state.chartMode = btn.dataset.mode;
      modes.querySelectorAll('.chart-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      animateBarChart(activePrices());
    });
  });
}

// ─── CHART INSIGHTS & DETAIL ─────────────────────────────────────────────────
function renderChartInsights(prices) {
  const el = document.getElementById('chartInsights');
  if (!el) return;
  if (!prices?.length) { el.innerHTML = ''; return; }
  const vals = prices.map(p => p.price);
  const minVal = Math.min(...vals), maxVal = Math.max(...vals);
  const avgVal = vals.reduce((s, v) => s + v, 0) / vals.length;
  const minIdx = vals.indexOf(minVal), maxIdx = vals.indexOf(maxVal);

  const chips = [];
  if (state.activeTab === 'today') {
    const nowIdx = prices.findIndex(p => p.hour === new Date().getHours());
    if (nowIdx >= 0) chips.push({
      cls: 'chip-now', idx: nowIdx, label: 'Ahora',
      color: priceGradientColor(normalizePrice(prices[nowIdx].price, prices)),
      value: `${fmtHour(prices[nowIdx].hour)} · ${fmtKwhShort(prices[nowIdx].price)} €`,
    });
  }
  chips.push(
    { cls: '', idx: minIdx, label: 'Mínimo', color: priceGradientColor(0),
      value: `${fmtHour(prices[minIdx].hour)} · ${fmtKwhShort(minVal)} €` },
    { cls: '', idx: maxIdx, label: 'Máximo', color: priceGradientColor(1),
      value: `${fmtHour(prices[maxIdx].hour)} · ${fmtKwhShort(maxVal)} €` },
    { cls: '', idx: '', label: 'Media', color: priceGradientColor(0.5),
      value: `${fmtKwhShort(avgVal)} €/kWh` },
  );

  el.innerHTML = chips.map(c => `
    <button class="insight-chip ${c.cls}" data-idx="${c.idx}">
      <span class="chip-dot" style="color:${c.color};background:${c.color}"></span>
      <span class="chip-text">
        <span class="chip-label">${c.label}</span>
        <span class="chip-value">${c.value}</span>
      </span>
    </button>`).join('');

  el.querySelectorAll('.insight-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.idx;
      const idx = v === '' ? null : Number.parseInt(v, 10);
      state.chartSelIdx = (state.chartSelIdx === idx) ? null : idx;
      hoveredIdx = null;
      syncInsightActive();
      drawBarChart(activePrices(), 1);
      updateChartDetail(activePrices(), state.chartSelIdx);
    });
  });
  syncInsightActive();
}

function syncInsightActive() {
  const el = document.getElementById('chartInsights');
  if (!el) return;
  el.querySelectorAll('.insight-chip').forEach(b => {
    const v = b.dataset.idx === '' ? null : Number.parseInt(b.dataset.idx, 10);
    b.classList.toggle('active', v !== null && v === state.chartSelIdx);
  });
}

// Resolve which hour index the detail panel should show.
function chartDetailIdx(prices, idx) {
  if (idx != null && idx >= 0) return idx;
  if (state.activeTab === 'today') {
    const ni = prices.findIndex(p => p.hour === new Date().getHours());
    if (ni >= 0) return ni;
  }
  const mn = Math.min(...prices.map(p => p.price));
  return prices.findIndex(p => p.price === mn);
}

function priceVsAvgText(pct) {
  if (pct <= -0.5) return `${Math.abs(Math.round(pct))}% más barato que la media`;
  if (pct >= 0.5)  return `${Math.round(pct)}% más caro que la media`;
  return 'En la media del día';
}

function priceRankText(rank, n) {
  if (rank === 1) return 'la más barata';
  if (rank === n) return 'la más cara';
  return `de ${n} horas`;
}

function updateChartDetail(prices, idx) {
  const el = document.getElementById('chartDetail');
  if (!el) return;
  if (!prices?.length) { el.innerHTML = ''; return; }

  const i = chartDetailIdx(prices, idx);
  const { hour, price } = prices[i];
  const vals = prices.map(p => p.price);
  const minVal = Math.min(...vals), maxVal = Math.max(...vals);
  const avgVal = vals.reduce((s, v) => s + v, 0) / vals.length;
  const col = priceGradientColor(normalizePrice(price, prices));
  const pct = avgVal ? ((price - avgVal) / avgVal) * 100 : 0;
  const rank = [...prices].sort((a, b) => a.price - b.price).findIndex(p => p.hour === hour) + 1;
  const markPos = (normalizePrice(price, prices) * 100).toFixed(1);
  const isNow = state.activeTab === 'today' && hour === new Date().getHours();
  const sign = pct >= 0 ? '+' : '';

  el.style.borderLeftColor = col;
  el.innerHTML = `
    <div class="detail-main">
      <div class="detail-range">${isNow ? '⚡ AHORA · ' : ''}${fmtHour(hour)} – ${fmtHour((hour + 1) % 24)}</div>
      <div class="detail-price" style="color:${col}">${fmtKwhShort(price)} <small>€/kWh</small></div>
      <div class="detail-tier" style="color:${col}">${tierLabel(price)} · ${fmtMWh(price)} €/MWh</div>
    </div>
    <div class="detail-compare">
      <div class="detail-compare-head">
        <span>${priceVsAvgText(pct)}</span>
        <b style="color:${col}">${sign}${Math.round(pct)}%</b>
      </div>
      <div class="detail-bar-track"><span class="detail-bar-marker" style="left:${markPos}%"></span></div>
      <div class="detail-scale">
        <span>${fmtKwhShort(minVal)} €</span>
        <span>media ${fmtKwhShort(avgVal)} €</span>
        <span>${fmtKwhShort(maxVal)} €</span>
      </div>
    </div>
    <div class="detail-rank"><b>#${rank}</b><span>${priceRankText(rank, prices.length)}</span></div>`;
}

function showTooltip(hour, price, prices, mouseX, mouseY) {
  const ps  = prices || activePrices();
  const box = document.getElementById('tooltipBox');
  const col = priceGradientColor(normalizePrice(price, ps));
  box.style.display = 'block';
  box.style.borderColor = col + '44';
  document.getElementById('ttHour').textContent  = `${fmtHour(hour)} – ${fmtHour(hour + 1)}`;
  document.getElementById('ttPrice').textContent = `${fmtKwhShort(price)} €/kWh  ·  ${fmtMWh(price)} €/MWh`;
  document.getElementById('ttPrice').style.color = col;
  document.getElementById('ttTier').textContent  = tierLabel(price);
  document.getElementById('ttTier').style.color  = col;

  // Posicionar cerca del mouse con offset
  const offsetX = 20;
  const offsetY = 20;
  let left = mouseX + offsetX;
  let top = mouseY + offsetY;

  // Evitar que se salga de la pantalla
  const rect = box.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) {
    left = mouseX - rect.width - offsetX;
  }
  if (top + rect.height > window.innerHeight - 10) {
    top = mouseY - rect.height - offsetY;
  }

  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltipBox');
  if (tooltip) tooltip.style.display = 'none';
}

/**
 * Show a custom HTML tooltip element at mouse position
 */
function showCustomTooltipElement(html, mouseX, mouseY) {
  // Remove existing tooltip if any
  const existing = document.getElementById('customTooltip');
  if (existing) existing.remove();

  const tooltip = document.createElement('div');
  tooltip.id = 'customTooltip';
  tooltip.innerHTML = html;
  tooltip.style.position = 'fixed';
  tooltip.style.zIndex = '10000';
  tooltip.style.pointerEvents = 'none';
  document.body.appendChild(tooltip);

  // Measure tooltip width and adjust position to keep it on screen
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Position horizontally: if tooltip would go off right edge, show on left
  let left = mouseX + 15;
  if (left + tooltipWidth > viewportWidth - 10) {
    left = mouseX - tooltipWidth - 15;
  }
  // Ensure it doesn't go off the left edge either
  if (left < 10) left = 10;

  // Position vertically: if tooltip would go off bottom, show above cursor
  let top = mouseY - 10;
  if (top + tooltipHeight > viewportHeight - 10) {
    top = mouseY - tooltipHeight - 10;
  }
  // Ensure it doesn't go off the top edge either
  if (top < 10) top = 10;

  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';

  // Hide old tooltip
  hideTooltip();

  // Hide tooltip on scroll to prevent it from staying visible
  const hideOnScroll = () => {
    if (document.getElementById('customTooltip')) {
      document.getElementById('customTooltip').style.display = 'none';
    }
    window.removeEventListener('scroll', hideOnScroll, true);
  };
  window.addEventListener('scroll', hideOnScroll, true);
}

// ─── HEATMAP ─────────────────────────────────────────────────────────────────
function renderHeatmap(prices) {
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  const currentHour = new Date().getHours();
  prices.forEach(({ hour, price }) => {
    const n    = normalizePrice(price, prices);
    const col  = priceGradientColor(n);
    const cell = document.createElement('div');
    const isCurrent = hour === currentHour && state.activeTab === 'today';
    cell.className = 'heatmap-cell' + (isCurrent ? ' current-hour' : '');
    cell.style.background = col;
    cell.style.setProperty('--pulse-color', col);
    cell.title = `${fmtHour(hour)}: ${fmtKwhShort(price)} €/kWh`;
    cell.addEventListener('click', (e) => showTooltip(hour, price, prices, e.clientX, e.clientY));
    grid.appendChild(cell);
  });
}

// ─── BEST WINDOWS (simple 2h) ────────────────────────────────────────────────
function renderBestWindows(prices) {
  const list = document.getElementById('windowsList');
  if (!prices.length) { list.innerHTML = '<div class="loading-msg">Sin datos disponibles</div>'; return; }

  const avgPrice = prices.reduce((s,p)=>s+p.price,0) / prices.length;

  // Generate windows of all durations (3h to 8h)
  const allWindows = [];
  for (let dur = 3; dur <= 8; dur++) {
    for (let i = 0; i <= prices.length - dur; i++) {
      const slice = prices.slice(i, i + dur);
      const avg = slice.reduce((s, p) => s + p.price, 0) / dur;
      allWindows.push({
        start: slice[0].hour,
        end: slice[slice.length - 1].hour,
        duration: dur,
        avg: avg,
        prices: slice
      });
    }
  }

  // Sort by average price (lowest first)
  allWindows.sort((a, b) => a.avg - b.avg);

  // Select top 3 non-consecutive windows
  const best = [];
  const usedHours = new Set();

  for (const w of allWindows) {
    if (best.length >= 3) break;
    const hrs = w.prices.map(p => p.hour);
    if (!hrs.some(h => usedHours.has(h))) {
      best.push(w);
      hrs.forEach(h => usedHours.add(h));
    }
  }

  // Render results
  list.innerHTML = '';
  const windowSlotData = [];

  best.forEach((w, i) => {
    const saving = ((avgPrice - w.avg) / avgPrice * 100).toFixed(0);
    const rankClass = ['rank-1', 'rank-2', 'rank-3'][i];
    const item = document.createElement('div');
    item.className = 'window-item';
    item.innerHTML = `
      <div class="window-rank ${rankClass}">${i + 1}</div>
      <div class="window-info">
        <div class="window-hours">${fmtHour(w.start)} – ${fmtHour(w.end + 1)}</div>
        <div class="window-price">Media: ${fmtKwhShort(w.avg)} €/kWh</div>
      </div>
      <canvas class="window-mini-chart" width="120" height="50" data-idx="${i}"></canvas>
      <div class="window-saving">${saving > 0 ? '−' + saving + '%' : 'Mejor'}</div>`;
    list.appendChild(item);

    // Collect slot hours for mini chart
    const slotHours = new Set(w.prices.map(p => p.hour));
    windowSlotData.push({ start: w.start, hours: slotHours, duration: w.duration });
  });

  // Draw mini charts for each window item
  windowSlotData.forEach((slotData, i) => {
    const canvas = list.querySelector(`.window-mini-chart[data-idx="${i}"]`);
    if (canvas) drawMiniChart(canvas, prices, slotData);
  });
}

// ─── GAUGE ───────────────────────────────────────────────────────────────────
function drawGauge(prices) {
  const canvas = document.getElementById('gaugeChart');
  if (!canvas) return;
  const host = canvas.parentElement;               // .gauge-card
  let avail = 420;
  if (host) {
    const cs = getComputedStyle(host);
    avail = host.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
  }
  const cssW = Math.max(240, Math.min(avail, 460));
  const cssH = Math.round(cssW * 0.52);
  const ctx  = prepCanvas(canvas, cssW, cssH);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);

  const currentHour  = new Date().getHours();
  const currentEntry = prices.find(p => p.hour === currentHour) || prices[prices.length-1];
  if (!currentEntry) return;

  // Use percentage relative to today's maximum price (not min-max normalized)
  const maxPrice = Math.max(...prices.map(p => p.price));
  const n        = Math.min(1, Math.max(0, currentEntry.price / maxPrice));
  const col      = priceGradientColor(n);
  const cx       = W/2, cy = H - 40;
  const R        = Math.min(W, H*1.8) * 0.38;

  // Draw background arc (full semi-circle)
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0);
  ctx.lineWidth = 18; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineCap = 'round'; ctx.stroke();

  // Draw colored arc up to the percentage of max
  const endAngle = Math.PI + n * Math.PI;
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, endAngle);
  ctx.lineWidth = 18; ctx.strokeStyle = col;
  ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.lineCap = 'round'; ctx.stroke();
  ctx.shadowBlur = 0;

  // Min/Max labels
  ctx.fillStyle = '#8B96AA'; ctx.font = '10px Space Grotesk, sans-serif';
  ctx.textAlign = 'left';  ctx.fillText('0%', cx-R-2, cy+16);
  ctx.textAlign = 'right'; ctx.fillText('100%', cx+R+2, cy+16);

  // Draw needle
  const nx = cx + Math.cos(Math.PI + n*Math.PI) * (R-24);
  const ny = cy + Math.sin(Math.PI + n*Math.PI) * (R-24);
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(nx,ny);
  ctx.strokeStyle = '#E8EDF5'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fillStyle='#E8EDF5'; ctx.fill();

  document.getElementById('gaugeLabel').textContent = fmtKwh(currentEntry.price);
  document.getElementById('gaugeLabel').style.color = col;
  document.getElementById('percentileText').textContent = `${Math.round(n*100)}% del precio maximo de hoy`;
}

// ─── CONSUMPTION PLANNER ─────────────────────────────────────────────────────
function initPlanner() {
  const btn = document.getElementById('plannerCalcBtn');
  if (!btn) return;
  btn.addEventListener('click', runPlanner);
  // Also allow Enter in inputs
  ['plannerHours','plannerWatts'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') runPlanner(); });
  });
}

function runPlanner() {
  const hoursVal  = parseFloat(document.getElementById('plannerHours').value);
  const wattsVal  = parseFloat(document.getElementById('plannerWatts').value);
  const tabSrc    = document.getElementById('plannerTab').value; // 'today' or 'tomorrow'
  const resultsEl = document.getElementById('plannerResults');

  if (!hoursVal || isNaN(hoursVal) || hoursVal < 1 || hoursVal > 23) {
    resultsEl.innerHTML = '<div class="planner-error">⚠️ Introduce un número de horas válido (1–23).</div>';
    return;
  }

  const prices = tabSrc === 'tomorrow' ? state.tomorrowPrices : state.todayPrices;
  if (!prices.length) {
    resultsEl.innerHTML = '<div class="planner-error">⚠️ No hay datos disponibles para ese día.</div>';
    return;
  }

  const dur = Math.round(hoursVal); // integer hours for sliding window
  if (dur > prices.length) {
    resultsEl.innerHTML = '<div class="planner-error">⚠️ La duración supera las horas disponibles.</div>';
    return;
  }

  // Sliding window of `dur` consecutive hours
  const windows = [];
  for (let i = 0; i <= prices.length - dur; i++) {
    const slice = prices.slice(i, i + dur);
    const avgP  = slice.reduce((s,p)=>s+p.price,0) / dur;
    windows.push({ startHour: slice[0].hour, endHour: slice[slice.length-1].hour, avgMWh: avgP, slice });
  }
  windows.sort((a,b) => a.avgMWh - b.avgMWh);

  // Top 3 non-overlapping
  const best = []; const usedH = new Set();
  for (const w of windows) {
    if (best.length >= 3) break;
    const hrs = w.slice.map(p=>p.hour);
    if (!hrs.some(h=>usedH.has(h))) { best.push(w); hrs.forEach(h=>usedH.add(h)); }
  }

  // Calculate cost if watts provided
  const hasWatts = wattsVal && !isNaN(wattsVal) && wattsVal > 0;
  const kWh = hasWatts ? (wattsVal / 1000) * dur : null; // total kWh consumed

  // Render results
  const dayLabel = tabSrc === 'tomorrow' ? 'mañana' : 'hoy';
  let html = `<div class="planner-summary">
    Mejores tramos de <strong>${dur}h</strong> para consumir
    ${hasWatts ? `<strong>${wattsVal.toLocaleString('es-ES')}W</strong>` : ''} — ${dayLabel}
  </div>
  <div class="planner-items">`;

  const medals = ['🥇','🥈','🥉'];
  best.forEach((w, i) => {
    const col  = priceGradientColor(normalizePrice(w.avgMWh, prices));
    const kwhP = w.avgMWh / 1000; // €/kWh
    const costEur = kWh ? (kWh * kwhP) : null;
    const saving  = i > 0 ? (((best[0].avgMWh - w.avgMWh) / best[0].avgMWh) * -100).toFixed(1) : null;

    html += `<div class="planner-item" style="--accent:${col}">
      <div class="planner-rank">${medals[i]}</div>
      <div class="planner-info">
        <div class="planner-time">${fmtHour(w.startHour)} – ${fmtHour(w.endHour + 1)}</div>
        <div class="planner-hours-row">`;

    // Mini hour pills
    w.slice.forEach(p => {
      const cn = normalizePrice(p.price, prices);
      const c  = priceGradientColor(cn);
      html += `<span class="hour-pill" style="background:${c}22;border-color:${c}55;color:${c}">${String(p.hour).padStart(2,'0')}</span>`;
    });

    html += `</div>
      </div>
      <div class="planner-cost-col">
        <div class="planner-avg" style="color:${col}">${fmtKwhShort(w.avgMWh)} €/kWh</div>
        ${costEur != null ? `<div class="planner-total">Coste estimado: <strong>${costEur.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €</strong></div>` : ''}
        ${i > 0 && saving ? `<div class="planner-vs">vs. óptimo: +${Math.abs(parseFloat(saving)).toFixed(1)}%</div>` : (i===0?'<div class="planner-badge-best">✓ Óptimo</div>':'')}
      </div>
    </div>`;
  });

  html += '</div>';
  if (hasWatts && kWh) {
    html += `<div class="planner-footnote">Energía total: ${kWh.toFixed(2)} kWh · Precio medio óptimo: ${fmtKwhShort(best[0].avgMWh)} €/kWh</div>`;
  }

  resultsEl.innerHTML = html;
}

// ─── SLOT WIDGET — CONTADOR DE TRAMOS ────────────────────────────────────────

// Pure validation: returns { valid, message }
function validateSlotInputs(rawDuration, rawPower, availableHours) {
  const dur = Number(rawDuration);
  const pow = Number(rawPower);
  if (isNaN(dur) || !Number.isInteger(dur) || dur < 1 || dur > 24) {
    return { valid: false, message: 'La duración debe ser un número entero entre 1 y 24 horas.' };
  }
  if (isNaN(pow) || pow <= 0) {
    return { valid: false, message: 'La potencia debe ser un número positivo en vatios.' };
  }
  if (dur > availableHours) {
    return { valid: false, message: `La duración solicitada (${dur}h) supera las horas disponibles del día (${availableHours}h).` };
  }
  return { valid: true, message: '' };
}

// Pure builder: returns every candidate window of `duration` hours.
// `duration` may be fractional — the trailing partial hour is weighted by its fraction
// so a 6h45m task counts the full price of each whole hour plus 45/60 of the last hour.
// Each window: { start, end, avg, slice, partial, duration }
//   slice   = full whole-hour entries used
//   partial = { hour, price, fraction } for the trailing sub-hour, or null when round
function buildSlotWindows(prices, duration) {
  const windows = [];
  if (!prices.length || duration > prices.length) return windows;

  const ceilDuration    = Math.ceil(duration);   // whole hours we must slice to cover the window
  const fullCount       = Math.floor(duration);  // number of complete hours
  const partialFraction = duration % 1;          // trailing fraction of an hour (0 when round)

  for (let i = 0; i <= prices.length - ceilDuration; i++) {
    const slice         = prices.slice(i, i + ceilDuration);
    const relevantSlice = slice.slice(0, fullCount);
    const totalHours    = relevantSlice.length + partialFraction;
    if (totalHours <= 0) continue;

    // Sum the full hours, then add the price of the trailing partial hour weighted by its fraction
    let sum = relevantSlice.reduce((s, p) => s + p.price, 0);
    let partial = null;
    if (partialFraction > 0 && slice.length > relevantSlice.length) {
      const partialEntry = slice[relevantSlice.length];
      sum += partialEntry.price * partialFraction;
      partial = { hour: partialEntry.hour, price: partialEntry.price, fraction: partialFraction };
    }

    const avg = sum / totalHours;
    const endHour = relevantSlice.length > 0
      ? relevantSlice[relevantSlice.length - 1].hour + 1
      : i + 1;

    windows.push({ start: i, end: endHour, avg, slice: relevantSlice, partial, duration: totalHours });
  }
  return windows;
}

// Pure search: returns up to 3 non-overlapping windows sorted by avg price asc
function findBestSlots(prices, duration) {
  const windows = buildSlotWindows(prices, duration);
  if (!windows.length) return [];
  // Sort ascending by avg price, tie-break by earlier start
  windows.sort((a, b) => a.avg - b.avg || a.start - b.start);
  // Greedy selection — accept up to 3 non-overlapping windows
  const accepted  = [];
  const usedHours = new Set();
  for (const w of windows) {
    if (accepted.length >= 3) break;
    const hours = w.slice.map(p => p.hour);
    if (w.partial) hours.push(w.partial.hour); // the partial hour is partly occupied too
    if (!hours.some(h => usedHours.has(h))) {
      accepted.push(w);
      hours.forEach(h => usedHours.add(h));
    }
  }
  return accepted;
}

// Pure search: returns the single most expensive window, or null when none exist
function findWorstSlot(prices, duration) {
  const windows = buildSlotWindows(prices, duration);
  if (!windows.length) return null;
  // Highest avg price wins; tie-break by earlier start for determinism
  return windows.reduce((worst, w) => (w.avg > worst.avg ? w : worst), windows[0]);
}

// Pure cost: (€/MWh ÷ 1000) × (W ÷ 1000) × h — propagates negatives as-is
function calcSlotCost(avgMWh, watts, hours) {
  return (avgMWh / 1000) * (watts / 1000) * hours;
}

// Format the end clock time of a window that starts at `startHour` and lasts `duration` hours.
// Handles fractional durations → "HH:MM" (e.g. 09:00 + 6.75h → "15:45").
function fmtSlotEndTime(startHour, duration) {
  const endHour = startHour + duration;
  const h = Math.floor(endHour);
  let m = Math.round((endHour - h) * 60);
  if (m === 60) return `${String(h + 1).padStart(2, '0')}:00`; // carry minute rounding into the hour
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Format "HH:00 – HH:00"
function fmtSlotRange(start, end) {
  return `${String(start).padStart(2, '0')}:00 – ${String(end).padStart(2, '0')}:00`;
}

// Format avg price in €/MWh with Spanish locale
function fmtSlotAvg(avgMWh) {
  return avgMWh.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €/MWh';
}

// Format cost in € with 2 decimals and Spanish locale
function fmtSlotCost(cost) {
  return cost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Render slot widget — reads state, updates #slotResults only
// NOTE: must be called alongside every price series update to stay in sync
function renderSlotWidget() {
  const resultsEl = document.getElementById('slotResults');
  if (!resultsEl) return;

  const prices = activePrices();

  if (!prices.length) {
    resultsEl.innerHTML = '<p class="slot-msg">No hay datos de precios disponibles para este día.</p>';
    return;
  }

  const validation = validateSlotInputs(state.slotDuration, state.slotPower, prices.length);
  if (!validation.valid) {
    resultsEl.innerHTML = `<p class="slot-msg slot-msg-error">${validation.message}</p>`;
    return;
  }

  const slots = findBestSlots(prices, state.slotDuration);
  if (!slots.length) {
    resultsEl.innerHTML = '<p class="slot-msg">No se han podido calcular tramos para la duración solicitada.</p>';
    return;
  }

  let html = '<div class="slot-list">';
  slots.forEach((slot, i) => {
    const cost  = calcSlotCost(slot.avg, state.slotPower, state.slotDuration);
    const isTop = i === 0;
    html += `
      <div class="slot-card${isTop ? ' slot-card-best' : ''}">
        ${isTop ? '<span class="slot-badge">✓ Recomendado</span>' : ''}
        <div class="slot-time">${fmtSlotRange(slot.start, slot.end)}</div>
        <div class="slot-price">${fmtSlotAvg(slot.avg)}</div>
        <div class="slot-cost">Coste estimado: <strong>${fmtSlotCost(cost)}</strong></div>
      </div>`;
  });
  html += '</div>';

  if (slots.length < 3) {
    html += `<p class="slot-msg slot-msg-info">Solo se ${slots.length === 1 ? 'ha podido proponer 1 tramo' : `han podido proponer ${slots.length} tramos`} sin solapamiento para la duración solicitada.</p>`;
  }

  resultsEl.innerHTML = html;
}

// Bind input events — only trigger renderSlotWidget, not global renderAll
function initSlotWidget() {
  const durEl = document.getElementById('slotDuration');
  const powEl = document.getElementById('slotPower');
  if (!durEl || !powEl) return;

  durEl.addEventListener('input', () => {
    state.slotDuration = parseInt(durEl.value, 10);
    renderSlotWidget();
  });
  powEl.addEventListener('input', () => {
    state.slotPower = parseFloat(powEl.value);
    renderSlotWidget();
  });
}

// ─── FLOATING CALC WIDGET ────────────────────────────────────────────────────
let calcState = {
  mode: null,       // 'auto' | 'manual'
  duration: null,   // hours (auto mode)
  startHour: 0,     // hours (manual mode)
  power: 2000,      // watts
  selectedTab: 'today', // 'today' | 'tomorrow'
};

function openCalcModal() {
  const modal = document.getElementById('calcModal');
  modal.style.display = 'flex';
  // Reset to step 1
  showCalcStep(1);
  // Reset selections
  calcState = { mode: null, duration: null, startHour: 0, power: 2000, selectedTab: 'today' };
  document.getElementById('manualPower').value = 2000;
  document.getElementById('manualStartHour').value = 0;
  document.getElementById('manualDuration').value = 2;
  const autoPowerEl = document.getElementById('autoPower');
  if (autoPowerEl) autoPowerEl.value = 2000;
}

function closeCalcModal() {
  document.getElementById('calcModal').style.display = 'none';
}

function showCalcStep(stepNum) {
  document.querySelectorAll('.calc-step').forEach(step => {
    step.style.display = 'none';
  });
  const targetStep = document.getElementById(`calcStep${stepNum}`);
  if (targetStep) {
    targetStep.style.display = 'block';
  }
}

function initCalcModal() {
  const btn = document.getElementById('floatingCalcBtn');
  if (!btn) return;
  btn.addEventListener('click', openCalcModal);

  // Close button
  const closeBtn = document.getElementById('calcModalClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCalcModal);
  }

  // Backdrop click to close
  const backdrop = document.getElementById('calcModalBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeCalcModal);
  }

  // Mode selection cards
  document.querySelectorAll('.calc-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      calcState.mode = mode;
      if (mode === 'auto') {
        showCalcStep(2);
      } else if (mode === 'manual') {
        showCalcStep(3);
      }
    });
  });

  // Duration buttons (auto mode)
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Skip the "Otro" button — handled separately
      if (btn.id === 'customDurationBtn') return;
      calcState.power    = readAutoPower(); // watts the user plans to consume
      calcState.duration = Number.parseInt(btn.dataset.dur, 10);
      // Calculate and show results
      calculateAndShowResults();
    });
  });

  // Custom duration "Otro" button
  const customDurationBtn = document.getElementById('customDurationBtn');
  const customDurationInputs = document.getElementById('customDurationInputs');
  const customDurationApply = document.getElementById('customDurationApply');

  if (customDurationBtn && customDurationInputs) {
    customDurationBtn.addEventListener('click', () => {
      // Toggle visibility of custom inputs
      const isHidden = customDurationInputs.style.display === 'none';
      customDurationInputs.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        customDurationBtn.textContent = 'Ocultar';
        customDurationBtn.classList.add('active');
      } else {
        customDurationBtn.textContent = 'Otro';
        customDurationBtn.classList.remove('active');
      }
    });
  }

  if (customDurationApply) {
    customDurationApply.addEventListener('click', () => {
      const hours = Number.parseInt(document.getElementById('customHours').value, 10) || 0;
      const minutes = Number.parseInt(document.getElementById('customMinutes').value, 10) || 0;

      // Convert to total minutes and validate
      const totalMinutes = (hours * 60) + minutes;

      if (totalMinutes < 1 || totalMinutes > 1440) {
        alert('Por favor, introduce un tiempo válido entre 1 minuto y 24 horas.');
        return;
      }

      // Store duration in minutes (we'll convert later)
      calcState.power    = readAutoPower(); // watts the user plans to consume
      calcState.duration = totalMinutes / 60; // Convert to hours for consistency
      // Calculate and show results
      calculateAndShowResults();

      // Reset custom inputs visibility
      customDurationInputs.style.display = 'none';
      customDurationBtn.textContent = 'Otro';
      customDurationBtn.classList.remove('active');
    });
  }

  // Back buttons
  const backToStep1 = document.getElementById('calcBackToStep1');
  if (backToStep1) {
    backToStep1.addEventListener('click', () => showCalcStep(1));
  }
  const backToStep1Manual = document.getElementById('calcBackToStep1Manual');
  if (backToStep1Manual) {
    backToStep1Manual.addEventListener('click', () => showCalcStep(1));
  }
  const backToMode = document.getElementById('calcBackToMode');
  if (backToMode) {
    backToMode.addEventListener('click', () => showCalcStep(1));
  }

  // Manual apply button
  const manualApply = document.getElementById('calcManualApply');
  if (manualApply) {
    manualApply.addEventListener('click', () => {
      calcState.startHour = Number.parseInt(document.getElementById('manualStartHour').value, 10);
      calcState.duration = Number.parseInt(document.getElementById('manualDuration').value, 10);
      calcState.power = Number.parseFloat(document.getElementById('manualPower').value) || 2000;
      calculateAndShowResults();
    });
  }
}

// Read the watts the user plans to consume (auto mode). Falls back to 2000 W.
function readAutoPower() {
  const val = Number.parseFloat(document.getElementById('autoPower')?.value);
  return (Number.isFinite(val) && val > 0) ? val : 2000;
}

// Build the hour-pill HTML for a window: one pill per full hour + an optional dashed
// pill for the trailing partial hour so the user can see the sub-hour IS counted.
function buildSlotPills(slot, prices) {
  let pills = '';
  slot.slice.forEach(p => {
    const c = priceGradientColor(normalizePrice(p.price, prices));
    pills += `<span class="calc-hour-pill" style="border-color:${c}44;color:${c}">${String(p.hour).padStart(2,'0')}: ${fmtKwhShort(p.price)}</span>`;
  });
  if (slot.partial) {
    const c = priceGradientColor(normalizePrice(slot.partial.price, prices));
    const mins = Math.round(slot.partial.fraction * 60);
    pills += `<span class="calc-hour-pill calc-hour-pill-partial" style="border-color:${c}44;color:${c}">${String(slot.partial.hour).padStart(2,'0')}: ${fmtKwhShort(slot.partial.price)} · ${mins} min</span>`;
  }
  return pills;
}

// Set of hours a window occupies (full hours + the partial hour) for chart highlighting
function slotHourSet(slot) {
  const set = new Set(slot.slice.map(p => p.hour));
  if (slot.partial) set.add(slot.partial.hour);
  return set;
}

function calculateAndShowResults() {
  const prices = activePrices();
  if (!prices.length) {
    document.getElementById('calcResults').innerHTML = '<p class="slot-msg">No hay datos disponibles.</p>';
    showCalcStep(4);
    return;
  }

  const resultsEl = document.getElementById('calcResults');
  let html = '';
  const slotsData = [];

  if (calcState.mode === 'auto') {
    // Find best non-overlapping windows
    const slots = findBestSlots(prices, calcState.duration);
    if (!slots.length) {
      resultsEl.innerHTML = '<p class="slot-msg">No se encontraron franjas para esa duración.</p>';
      showCalcStep(4);
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    slots.forEach((slot, i) => {
      const kwhPrice = slot.avg / 1000; // €/kWh
      const costEur = (kwhPrice * (calcState.power / 1000)) * calcState.duration;
      const col = priceGradientColor(normalizePrice(slot.avg, prices));
      const isBest = i === 0;

      const pillsHtml  = buildSlotPills(slot, prices);
      const endTimeStr = fmtSlotEndTime(slot.start, calcState.duration);

      // Collect slot hours (incl. partial) for mini chart highlighting
      slotsData.push({ start: slot.start, hours: slotHourSet(slot), duration: calcState.duration });

      html += `
        <div class="calc-result-card ${isBest ? 'best' : ''}">
          ${isBest
            ? '<span class="calc-result-rank best-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg><span>Mejor</span></span>'
            : `<span class="calc-result-rank">${medals[i]}<span>#${i+1}</span></span>`}
          <div class="calc-result-title-area">
            <div>
              <div class="calc-result-time">${fmtHour(slot.start)} – ${endTimeStr}</div>
              <div class="calc-result-summary">
                <span class="calc-result-duration">${fmtDuration(calcState.duration)}</span>
              </div>
            </div>
            <canvas class="calc-mini-chart" width="200" height="60" data-idx="${i}"></canvas>
          </div>
          <div class="calc-result-info">
            <div class="calc-result-price">
              Precio: <strong style="color:${col}">${fmtKwh(slot.avg)}</strong>
              &nbsp;·&nbsp;
              ${fmtMWh(slot.avg)} €/MWh
            </div>
            <div class="calc-result-cost">${costEur.toFixed(4).replace('.', ',')} €</div>
            <div class="calc-result-hours">${pillsHtml}</div>
          </div>
        </div>`;
    });

    // ── Worst option — most expensive window of the same duration ──────────────
    const worst = findWorstSlot(prices, calcState.duration);
    const bestStarts = new Set(slots.map(s => s.start));
    let worstSlotData = null;
    if (worst && !bestStarts.has(worst.start)) {
      const worstCost = (worst.avg / 1000) * (calcState.power / 1000) * calcState.duration;
      const bestCost  = (slots[0].avg / 1000) * (calcState.power / 1000) * calcState.duration;
      const extraCost = worstCost - bestCost;
      const wCol      = priceGradientColor(normalizePrice(worst.avg, prices));
      const wPills    = buildSlotPills(worst, prices);
      const wEndStr   = fmtSlotEndTime(worst.start, calcState.duration);
      worstSlotData   = { start: worst.start, hours: slotHourSet(worst), duration: calcState.duration };

      html += `
        <div class="calc-worst-divider"><span>La peor opción</span></div>
        <div class="calc-result-card worst">
          <span class="calc-result-rank worst-badge">
          ✗<span>Peor</span></span>
          <div class="calc-result-title-area">
            <div>
              <div class="calc-result-time">${fmtHour(worst.start)} – ${wEndStr}</div>
              <div class="calc-result-summary">
                <span class="calc-result-duration">${fmtDuration(calcState.duration)}</span>
              </div>
            </div>
            <canvas class="calc-mini-chart" width="200" height="60" data-idx="worst"></canvas>
          </div>
          <div class="calc-result-info">
            <div class="calc-result-price">
              Precio: <strong style="color:${wCol}">${fmtKwh(worst.avg)}</strong>
              &nbsp;·&nbsp;
              ${fmtMWh(worst.avg)} €/MWh
            </div>
            <div class="calc-result-cost worst-cost">${worstCost.toFixed(4).replace('.', ',')} €</div>
            <div class="calc-result-extra">Pagarías <strong>${extraCost.toFixed(4).replace('.', ',')} €</strong> más que en la mejor franja</div>
            <div class="calc-result-hours">${wPills}</div>
          </div>
        </div>`;
    }

    resultsEl.innerHTML = html;

    // Draw mini charts for each recommended card
    slotsData.forEach((slotData, i) => {
      const canvas = resultsEl.querySelector(`.calc-mini-chart[data-idx="${i}"]`);
      if (canvas) drawMiniChart(canvas, prices, slotData);
    });
    // Draw worst-option mini chart
    if (worstSlotData) {
      const worstCanvas = resultsEl.querySelector('.calc-mini-chart[data-idx="worst"]');
      if (worstCanvas) drawMiniChart(worstCanvas, prices, worstSlotData);
    }

  } else if (calcState.mode === 'manual') {
    // Manual selection
    const startH = calcState.startHour;
    const dur = calcState.duration;
    const availableHours = prices.length - startH;

    if (dur > availableHours) {
      resultsEl.innerHTML = `<p class="slot-msg slot-msg-error">La duración (${fmtDuration(dur)}) supera las horas disponibles desde las ${fmtHour(startH)} (${availableHours}h restantes).</p>`;
      showCalcStep(4);
      return;
    }

    const slice = prices.slice(startH, Math.ceil(startH + dur));
    const avgPrice = slice.reduce((s, p) => s + p.price, 0) / dur;
    const kwhPrice = avgPrice / 1000; // €/kWh
    const costEur = (kwhPrice * (calcState.power / 1000)) * dur;
    const col = priceGradientColor(normalizePrice(avgPrice, prices));

    // Build hour pills
    let pillsHtml = '';
    slice.forEach(p => {
      const pColor = priceGradientColor(normalizePrice(p.price, prices));
      pillsHtml += `<span class="calc-hour-pill" style="border-color:${pColor}44;color:${pColor}">${String(p.hour).padStart(2,'0')}: ${fmtKwhShort(p.price)}</span>`;
    });

    const endH = startH + dur;
    const endMin = Math.round((endH % 1) * 60);
    const endTimeStr = endMin === 0 ? `${String(Math.floor(endH)).padStart(2, '0')}:00` : `${String(Math.floor(endH)).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    const slotHours = new Set(slice.map(p => p.hour));
    const manualSlotData = { start: startH, hours: slotHours, duration: dur };

    html += `
      <div class="calc-result-card best">
        <span class="calc-result-rank best-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg><span>Seleccionada</span></span>
        <div class="calc-result-title-area">
          <div>
            <div class="calc-result-time">${fmtHour(startH)} – ${endTimeStr}</div>
            <div class="calc-result-summary">
              <span class="calc-result-duration">${fmtDuration(dur)}</span>
            </div>
          </div>
          <canvas class="calc-mini-chart" width="200" height="90" data-idx="manual"></canvas>
        </div>
        <div class="calc-result-info">
          <div class="calc-result-price">
            Precio medio: <strong style="color:${col}">${fmtKwh(avgPrice)}</strong>
            &nbsp;·&nbsp;
            ${fmtMWh(avgPrice)} €/MWh
          </div>
          ${calcState.power > 0 ? `<div class="calc-result-cost">${costEur.toFixed(4).replace('.', ',')} €</div>` : ''}
          <div class="calc-result-hours">${pillsHtml}</div>
        </div>
      </div>`;

    resultsEl.innerHTML = html;

    // Draw mini chart for manual selection
    const manualCanvas = resultsEl.querySelector('.calc-mini-chart[data-idx="manual"]');
    if (manualCanvas) drawMiniChart(manualCanvas, prices, manualSlotData);
  }

  showCalcStep(4);
}

// ─── MINI CHART FOR RESULT CARDS ─────────────────────────────────────────────
function drawMiniChart(canvas, prices, slotData) {
  const ctx = canvas.getContext('2d');

  // Chart width fills cell, height enlarged for better visibility
  const W = 200, H = 60;
  canvas.width = W * 2;
  canvas.height = H * 2;
  canvas.style.width = '50%';
  canvas.style.height = H + 'px';
  canvas.style.height = H + 'px !important';
  canvas.style.marginLeft = '10%';
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, W, H);

  if (!prices.length) return;

  // All 24 hours, tall bar = expensive, short bar = cheap
  const maxVal = Math.max(...prices.map(p => p.price)) * 1.1;
  const n = prices.length;
  const barW = W / n;
  const gap = 2.5; // Even wider gap = ultra-thin bars
  const slotHours = slotData.hours;

  prices.forEach((p, i) => {
    const x = i * barW;
    const bw = Math.max(0.5, barW - gap); // Minimum 0.5px bar (super thin)
    // Direct proportion: higher price = taller bar
    const norm = p.price / maxVal;
    const bh = Math.max(1, norm * (H - 1));
    const y = H - 1 - bh;

    const isSlotHour = slotHours.has(p.hour);

    if (isSlotHour) {
      // Bright colored for recommended slot
      const col = priceGradientColor(normalizePrice(p.price, prices));
      ctx.fillStyle = col;
    } else {
      // Dimmed gray for non-recommended hours
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    }

    // Super thin bars, slightly rounded top only for highlighted
    const r = Math.min(0.5, bw / 2);
    ctx.beginPath();
    if (isSlotHour && bw > 3) {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, H - 1);
      ctx.lineTo(x, H - 1);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    } else {
      ctx.rect(x, y, bw, bh);
    }
    ctx.closePath();
    ctx.fill();
  });
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
// State for history comparison
let hoveredHistoryDayIdx = null;

/**
 * Load prices for a date range (N days or custom dates)
 */
async function loadHistoryRange(numDays) {
  const today = new Date();
  const dates = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(toLocalDateStr(d));
  }

  const results = await Promise.all(dates.map(d => loadHistoryDate(d)));

  state.historyDayData = results
    .filter((r, i) => r?.length)
    .map((prices, idx) => {
      const dateStr = dates[idx];
      const date = new Date(dateStr + 'T00:00:00');
      const pricesOnly = prices.map(p => p.price);
      const minVal = Math.min(...pricesOnly);
      const maxVal = Math.max(...pricesOnly);
      const avgVal = pricesOnly.reduce((s, v) => s + v, 0) / pricesOnly.length;

      const minHour = prices.find(p => p.price === minVal)?.hour ?? 0;
      const maxHour = prices.find(p => p.price === maxVal)?.hour ?? 0;

      return {
        dateStr,
        date,
        min: minVal,
        max: maxVal,
        avg: avgVal,
        minHour,
        maxHour,
        prices: pricesOnly
      };
    });

  renderHistoryComparison();
}

/**
 * Load prices for a custom date range
 */
async function loadHistoryCustomRange(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const dates = [];

  const current = new Date(start);
  while (current <= end) {
    dates.push(toLocalDateStr(current));
    current.setDate(current.getDate() + 1);
  }

  if (dates.length > 60) {
    showHistoryError('Máximo 60 días permitidos en consulta personalizada');
    return;
  }

  const results = await Promise.all(dates.map(d => loadHistoryDate(d)));

  state.historyDayData = results
    .filter((r, i) => r?.length)
    .map((prices, idx) => {
      const dateStr = dates[idx];
      const date = new Date(dateStr + 'T00:00:00');
      const pricesOnly = prices.map(p => p.price);
      const minVal = Math.min(...pricesOnly);
      const maxVal = Math.max(...pricesOnly);
      const avgVal = pricesOnly.reduce((s, v) => s + v, 0) / pricesOnly.length;

      const minHour = prices.find(p => p.price === minVal)?.hour ?? 0;
      const maxHour = prices.find(p => p.price === maxVal)?.hour ?? 0;

      return {
        dateStr,
        date,
        min: minVal,
        max: maxVal,
        avg: avgVal,
        minHour,
        maxHour,
        prices: pricesOnly
      };
    });

  renderHistoryComparison();
}

/**
 * Render the comparison chart and table
 */
function renderHistoryComparison() {
  const content = document.getElementById('historyContent');
  const empty = document.getElementById('historyEmpty');

  if (!state.historyDayData?.length) {
    content.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  content.style.display = 'block';

  const dayData = state.historyDayData;

  // Update title with date range
  const startDate = dayData[0].date.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const endDate = dayData[dayData.length - 1].date.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  document.getElementById('historyTitle').textContent =
    `Evolución de precios — ${startDate} a ${endDate}`;

  // Draw comparison chart
  drawHistoryComparisonChart(dayData);

  // Render table
  renderHistoryTable(dayData);
}

/**
 * Draw comparison chart with 3 lines: max, avg, min
 */
function drawHistoryComparisonChart(dayData) {
  const canvas = document.getElementById('historyComparisonChart');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  // Self-size: fixed height + horizontal scroll (wrapper is overflow-x:auto).
  // Guarantees a tall-enough plot area and a readable per-day width at any
  // viewport. Previously the canvas inherited its container width and collapsed
  // to a few px tall on narrow screens, making the chart unreadable.
  const padL = 70, padR = 20, padT = 24, padB = 48;
  const perDay = 48;
  const wrapper = canvas.parentElement;
  const availW  = wrapper?.clientWidth || 640;
  const cssW    = Math.max(availW, dayData.length * perDay + padL + padR);
  const cssH    = 320;

  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  if (!dayData.length) {
    ctx.fillStyle = '#8B96AA';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos disponibles.', W / 2, H / 2);
    return;
  }

  // Calculate global min/max for scaling
  const allMins = dayData.map(d => d.min);
  const allMaxs = dayData.map(d => d.max);
  const allAvgs = dayData.map(d => d.avg);
  const globalMin = Math.min(...allMins);
  const globalMax = Math.max(...allMaxs);
  const range = globalMax - globalMin || 1;
  const yMin = globalMin - range * 0.1;
  const yMax = globalMax + range * 0.1;
  const yRange = yMax - yMin;

  // Helper to convert data coordinates to canvas coordinates
  const xForIdx = (idx) => padL + (idx / (dayData.length - 1 || 1)) * chartW;
  const yForVal = (val) => padT + chartH - ((val - yMin) / yRange) * chartH;

  // Grid lines
  const gridLines = 5;
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + (i / gridLines) * chartH;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();

    // Y-axis labels (€/kWh)
    const val = yMax - (i / gridLines) * yRange;
    ctx.fillStyle = '#8B96AA';
    ctx.font = '10px Space Grotesk, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((val / 1000).toFixed(4), padL - 8, y + 3);
  }

  // Y-axis label
  ctx.save();
  ctx.translate(14, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#8B96AA';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('€/kWh', 0, 0);
  ctx.restore();

  // Draw lines: max (red), avg (amber), min (green)
  const series = [
    { data: dayData.map(d => d.max), color: '#FF5252', label: 'max' },
    { data: dayData.map(d => d.avg), color: '#FFD700', label: 'avg' },
    { data: dayData.map(d => d.min), color: '#00E5A0', label: 'min' }
  ];

  series.forEach(({ data, color }) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    data.forEach((val, idx) => {
      const x = xForIdx(idx);
      const y = yForVal(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Draw points
    data.forEach((val, idx) => {
      const x = xForIdx(idx);
      const y = yForVal(val);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0A0E1A';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  });

  // X-axis labels (dates) — spacing-aware so labels never overlap
  const stepPx = chartW / Math.max(1, dayData.length - 1);
  const labelInterval = Math.max(1, Math.round(38 / stepPx));
  dayData.forEach((day, idx) => {
    if (idx % labelInterval === 0 || idx === dayData.length - 1) {
      const x = xForIdx(idx);
      const dateStr = day.date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      ctx.fillStyle = '#8B96AA';
      ctx.font = '10px Space Grotesk, sans-serif';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(x, padT + chartH + 14);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(dateStr, 0, 0);
      ctx.restore();
    }
  });

  // Store chart metadata for hover interactions
  canvas._chartMeta = { dayData, yMin, yMax, yRange, padL, padT, chartW, chartH };
}

/**
 * Handle hover on comparison chart
 */
function bindHistoryComparisonChartEvents() {
  const canvas = document.getElementById('historyComparisonChart');
  if (!canvas) return;

  canvas.addEventListener('mousemove', (e) => {
    const meta = canvas._chartMeta;
    if (!meta) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx < meta.padL || mx > meta.padL + meta.chartW) {
      if (hoveredHistoryDayIdx !== null) {
        hoveredHistoryDayIdx = null;
        drawHistoryComparisonChart(state.historyDayData);
      }
      return;
    }

    // Find closest day
    const idx = Math.round(((mx - meta.padL) / meta.chartW) * (meta.dayData.length - 1 || 1));
    const clampedIdx = Math.max(0, Math.min(meta.dayData.length - 1, idx));

    if (hoveredHistoryDayIdx !== clampedIdx) {
      hoveredHistoryDayIdx = clampedIdx;
      drawHistoryComparisonChart(state.historyDayData);

      // Show tooltip
      const day = meta.dayData[clampedIdx];
      const dateStr = day.date.toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
      const tooltipHtml = `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;color:var(--text);font-size:0.85rem;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
          <strong style="color:var(--text);font-size:0.9rem;">${dateStr}</strong><br/>
          <span style="color:var(--green);">Mín:</span> ${(day.min / 1000).toFixed(4)} €/kWh <span style="color:var(--text-dim);">(h ${day.minHour})</span><br/>
          <span style="color:var(--red);">Máx:</span> ${(day.max / 1000).toFixed(4)} €/kWh <span style="color:var(--text-dim);">(h ${day.maxHour})</span><br/>
          <span style="color:var(--amber);">Media:</span> ${(day.avg / 1000).toFixed(4)} €/kWh
        </div>
      `;
      showCustomTooltipElement(tooltipHtml, e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredHistoryDayIdx = null;
    hideTooltip();
    drawHistoryComparisonChart(state.historyDayData);
  });
}

/**
 * Render comparison table
 */
function renderHistoryTable(dayData) {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '';

  dayData.forEach(day => {
    const dateStr = day.date.toLocaleDateString('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short'
    });

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${dateStr}</td>
      <td class="val-min">${(day.min / 1000).toFixed(4)}</td>
      <td>${day.minHour}</td>
      <td class="val-max">${(day.max / 1000).toFixed(4)}</td>
      <td>${day.maxHour}</td>
      <td class="val-avg">${(day.avg / 1000).toFixed(4)}</td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Show error message in history section
 */
function showHistoryError(message) {
  const content = document.getElementById('historyContent');
  const empty = document.getElementById('historyEmpty');
  content.style.display = 'none';
  empty.style.display = 'block';
  empty.className = 'history-empty';
  empty.innerHTML = `<p>${message}</p>`;
}

/**
 * Show history section
 */
function showHistorySection() {
  document.getElementById('historySection').style.display = 'block';
  document.querySelector('.chart-section').style.display = 'none';
  document.querySelector('.bottom-grid').style.display = 'none';
  renderHistoryComparison();
}

/**
 * Hide history section
 */
function hideHistorySection() {
  document.getElementById('historySection').style.display = 'none';
  document.querySelector('.chart-section').style.display = 'block';
  document.querySelector('.bottom-grid').style.display = 'grid';
}

/**
 * Initialize history tab
 */
function initHistory() {
  // Bind range button clicks
  const rangeButtons = document.querySelectorAll('.history-range-btn');
  rangeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const days = btn.dataset.days;

      // Update active state
      rangeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide custom date inputs
      const customDates = document.getElementById('historyCustomDates');
      if (days === 'custom') {
        customDates.style.display = 'flex';

        // Set default date range (last 7 days)
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const endDateInput = document.getElementById('historyEndDate');
        const startDateInput = document.getElementById('historyStartDate');

        endDateInput.max = toLocalDateStr(today);
        endDateInput.value = toLocalDateStr(today);

        startDateInput.max = endDateInput.value;
        startDateInput.value = toLocalDateStr(sevenDaysAgo);
      } else {
        customDates.style.display = 'none';
        loadHistoryRange(parseInt(days));
      }
    });
  });

  // Bind custom date load button
  const loadBtn = document.getElementById('historyLoadBtn');
  loadBtn.addEventListener('click', () => {
    const startDate = document.getElementById('historyStartDate').value;
    const endDate = document.getElementById('historyEndDate').value;

    if (!startDate || !endDate) {
      showHistoryError('Selecciona ambas fechas (inicio y fin)');
      return;
    }

    if (startDate > endDate) {
      showHistoryError('La fecha de inicio debe ser anterior a la fecha de fin');
      return;
    }

    loadBtn.disabled = true;
    loadBtn.textContent = 'Cargando...';

    // Show loading state
    const content = document.getElementById('historyContent');
    const empty = document.getElementById('historyEmpty');
    content.style.display = 'none';
    empty.style.display = 'block';
    empty.className = 'history-loading';
    empty.textContent = 'Cargando datos históricos';

    loadHistoryCustomRange(startDate, endDate)
      .catch(err => {
        console.error('Error loading history range:', err);
        empty.className = 'history-empty';
        empty.textContent = 'Error al cargar datos. Verifica tu conexión e intenta nuevamente.';
      })
      .finally(() => {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Cargar';
      });
  });

  // Bind comparison chart hover events
  bindHistoryComparisonChartEvents();

  // Auto-load 7 days by default when history tab is first opened
  // (will be triggered when user clicks the history tab)
}

// ─── COMPARE ─────────────────────────────────────────────────────────────────
// Compare today's hourly tariff against a user-selected day.
let hoveredCompareIdx = null;

function showCompareSection() {
  document.getElementById('compareSection').style.display = 'block';
  document.getElementById('historySection').style.display = 'none';
  document.querySelector('.chart-section').style.display = 'none';
  document.querySelector('.bottom-grid').style.display = 'none';
}

function hideCompareSection() {
  document.getElementById('compareSection').style.display = 'none';
}

/**
 * Fetch the selected day's prices (with demo fallback) and render the comparison.
 */
async function loadCompareDate(dateStr) {
  const data = await loadHistoryDate(dateStr);
  state.comparePrices = data || [];
  state.compareDate   = dateStr;
  renderCompare();
}

/**
 * Wrap loadCompareDate with the loading / error UI shared by the button and the
 * tab's first-visit auto-load.
 */
function triggerCompareLoad(dateStr) {
  if (!dateStr) return Promise.resolve();

  const loadBtn = document.getElementById('compareLoadBtn');
  const content = document.getElementById('compareContent');
  const empty   = document.getElementById('compareEmpty');

  if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = 'Cargando...'; }
  content.style.display = 'none';
  empty.className = 'compare-loading';
  empty.textContent = 'Cargando datos del día seleccionado';
  empty.style.display = 'block';

  return loadCompareDate(dateStr)
    .catch(err => {
      console.warn('Error loading compare date:', err);
      empty.className = 'compare-empty';
      empty.textContent = 'Error al cargar datos. Verifica tu conexión e intenta nuevamente.';
    })
    .finally(() => {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = 'Comparar'; }
    });
}

/**
 * Render the comparison title, summary and chart.
 */
function renderCompare() {
  const content = document.getElementById('compareContent');
  const empty   = document.getElementById('compareEmpty');

  if (!state.comparePrices?.length || !state.todayPrices?.length) {
    content.style.display = 'none';
    empty.className = 'compare-empty';
    empty.innerHTML = '<p>Selecciona una fecha para comparar su tarifa con la de hoy.</p>';
    empty.style.display = 'block';
    return;
  }

  empty.style.display   = 'none';
  content.style.display = 'block';

  const dateObj   = new Date(state.compareDate + 'T00:00:00');
  const dateLong  = dateObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  document.getElementById('compareTitle').textContent = `Hoy vs ${dateLong}`;
  document.getElementById('compareLegendOther').innerHTML =
    `<span class="legend-swatch legend-swatch-other"></span>${dateShort}`;

  renderCompareSummary(dateShort);
  drawCompareChart();
}

/**
 * Render the average comparison summary and verdict badge.
 */
function renderCompareSummary(dateShort) {
  const today = state.todayPrices;
  const other = state.comparePrices;
  const avg   = arr => arr.reduce((s, p) => s + p.price, 0) / arr.length;

  const todayAvg = avg(today);
  const otherAvg = avg(other);
  const diff     = todayAvg - otherAvg;
  const pct      = otherAvg === 0 ? 0 : Math.abs(diff / otherAvg) * 100;
  const cheaper  = diff <= 0;

  const verdictColor = cheaper ? 'var(--green)' : 'var(--red)';
  const verdictWord  = cheaper ? 'más barato' : 'más caro';
  const arrow        = cheaper ? '▼' : '▲';
  const pctStr       = pct.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  document.getElementById('compareSummary').innerHTML = `
    <div class="compare-stat">
      <div class="compare-stat-label">Media hoy</div>
      <div class="compare-stat-value" style="color:var(--green)">${fmtKwhShort(todayAvg)}</div>
      <div class="compare-stat-sub">€/kWh</div>
    </div>
    <div class="compare-stat">
      <div class="compare-stat-label">Media ${dateShort}</div>
      <div class="compare-stat-value" style="color:var(--amber)">${fmtKwhShort(otherAvg)}</div>
      <div class="compare-stat-sub">€/kWh</div>
    </div>
    <div class="compare-verdict">
      <div class="compare-verdict-main" style="color:${verdictColor}">${arrow} Hoy es un ${pctStr}% ${verdictWord}</div>
      <div class="compare-verdict-sub">Diferencia media de ${fmtKwhShort(Math.abs(diff))} €/kWh respecto al ${dateShort}</div>
    </div>`;
}

/**
 * Draw the comparison chart: today as green bars, the selected day as an amber line.
 */
function drawCompareChart() {
  const canvas = document.getElementById('compareChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const rect          = canvas.getBoundingClientRect();
  const displayWidth  = rect.width || 1100;
  const displayHeight = rect.height || 340;

  canvas.width  = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = displayWidth, H = displayHeight;
  const padL = 62, padR = 20, padT = 32, padB = 44;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  const today = state.todayPrices;
  const other = state.comparePrices;
  if (!today.length || !other.length) return;

  // Shared 0-based scale across both series so heights are directly comparable
  const allPrices = [...today.map(p => p.price), ...other.map(p => p.price)];
  const yMax      = Math.max(...allPrices) * 1.12 || 1;

  const n       = today.length;
  const barW    = chartW / n;
  const baseY   = padT + chartH;
  const yForVal = (val) => padT + chartH - (val / yMax) * chartH;
  const xCenterForIdx = (i) => padL + i * barW + barW / 2;

  // Align the selected-day line with today's hour grid (robust to DST 23/25h days)
  const idxForHour = new Map(today.map((p, i) => [p.hour, i]));
  const xForHour = (h) => xCenterForIdx(idxForHour.has(h) ? idxForHour.get(h) : (h / 23) * (n - 1));

  // Grid lines + Y labels (€/kWh)
  const gridCount = 5;
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridCount; i++) {
    const y = padT + chartH - (i / gridCount) * chartH;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
    const mwhVal = (yMax * i) / gridCount;
    ctx.fillStyle = '#8B96AA';
    ctx.font = '9px Space Grotesk, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((mwhVal / 1000).toFixed(4), padL - 6, y + 3);
  }

  // Y axis label
  ctx.save();
  ctx.translate(12, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#8B96AA';
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('€/kWh', 0, 0);
  ctx.restore();

  // Hover vertical guide (drawn under the bars/line)
  if (hoveredCompareIdx !== null && today[hoveredCompareIdx]) {
    const hx = xCenterForIdx(hoveredCompareIdx);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, baseY); ctx.stroke();
    ctx.setLineDash([]);
  }

  // TODAY — green bars
  today.forEach(({ hour, price }, i) => {
    const x  = padL + i * barW + barW * 0.18;
    const bw = barW * 0.64;
    const y  = yForVal(price);
    const isHov = hoveredCompareIdx === i;

    const grad = ctx.createLinearGradient(x, y, x, baseY);
    grad.addColorStop(0, '#00E5A0');
    grad.addColorStop(1, 'rgba(0,229,160,0.12)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = isHov ? 1 : 0.85;

    const r = Math.min(4, bw / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, baseY);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Hour labels
    ctx.fillStyle = '#8B96AA';
    ctx.font = '9px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(hour).padStart(2, '0'), padL + i * barW + barW / 2, baseY + 14);
  });

  // SELECTED DAY — amber line
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  other.forEach(({ hour, price }, idx) => {
    const x = xForHour(hour);
    const y = yForVal(price);
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Points on the line
  other.forEach(({ hour, price }) => {
    const x = xForHour(hour);
    const y = yForVal(price);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0A0E1A';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Store metadata for hover hit-testing
  canvas._compareMeta = { padL, padT, chartW, chartH, barW };
}

/**
 * Bind hover interactions on the comparison chart — shows both prices for the hour.
 */
function bindCompareChartEvents() {
  const canvas = document.getElementById('compareChart');
  if (!canvas) return;

  canvas.addEventListener('mousemove', (e) => {
    const meta = canvas._compareMeta;
    if (!meta) return;
    const today = state.todayPrices;
    const other = state.comparePrices;
    if (!today.length || !other.length) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    if (mx < meta.padL || mx > meta.padL + meta.chartW) {
      if (hoveredCompareIdx !== null) { hoveredCompareIdx = null; hideTooltip(); drawCompareChart(); }
      return;
    }

    const idx = Math.floor((mx - meta.padL) / meta.barW);
    const clamped = Math.max(0, Math.min(today.length - 1, idx));
    if (hoveredCompareIdx === clamped) return;

    hoveredCompareIdx = clamped;
    drawCompareChart();

    const hour   = today[clamped].hour;
    const tPrice = today[clamped].price;
    const oEntry = other.find(p => p.hour === hour);
    const oPrice = oEntry ? oEntry.price : null;
    const dateShort = new Date(state.compareDate + 'T00:00:00')
      .toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

    let diffHtml = '';
    if (oPrice != null) {
      const d       = tPrice - oPrice;
      const cheaper = d <= 0;
      const col     = cheaper ? 'var(--green)' : 'var(--red)';
      const word    = cheaper ? 'más barato' : 'más caro';
      const pct     = oPrice === 0 ? 0 : Math.abs(d / oPrice) * 100;
      const pctStr  = pct.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      diffHtml = `<div style="margin-top:6px;color:${col};font-size:0.8rem;">Hoy ${pctStr}% ${word}</div>`;
    }

    const html = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;color:var(--text);font-size:0.85rem;min-width:170px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
        <strong style="color:var(--text);font-size:0.9rem;">${fmtHour(hour)} – ${fmtHour(hour + 1)}</strong><br/>
        <span style="color:var(--green);">Hoy:</span> ${fmtKwhShort(tPrice)} €/kWh<br/>
        <span style="color:var(--amber);">${dateShort}:</span> ${oPrice == null ? 'sin dato' : fmtKwhShort(oPrice) + ' €/kWh'}
        ${diffHtml}
      </div>`;
    showCustomTooltipElement(html, e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredCompareIdx = null;
    hideTooltip();
    drawCompareChart();
  });
}

/**
 * Initialize the compare tab — date input defaults and event bindings.
 */
function initCompare() {
  const dateInput = document.getElementById('compareDate');
  const loadBtn   = document.getElementById('compareLoadBtn');
  if (!dateInput || !loadBtn) return;

  // Default: max selectable date is today, preselect yesterday
  const yesterday = toLocalDateStr(new Date(Date.now() - 86400000));
  dateInput.max   = getTodayStr();
  dateInput.value = yesterday;

  loadBtn.addEventListener('click', () => triggerCompareLoad(dateInput.value));

  bindCompareChartEvents();
}

// ─── TABS ────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide history section
      if (state.activeTab === 'history') {
        hideCompareSection();
        // Auto-load 7 days on first visit
        if (!state.historyDayData?.length) {
          loadHistoryRange(7);
        }
        showHistorySection();
      } else if (state.activeTab === 'compare') {
        showCompareSection();
        // Re-render if we already have data, otherwise auto-load the preselected day
        if (state.comparePrices?.length) {
          renderCompare();
        } else {
          triggerCompareLoad(document.getElementById('compareDate').value);
        }
      } else {
        hideHistorySection();
        hideCompareSection();
        const prices = activePrices();
        const label  = state.activeTab === 'today'
          ? `Tarifas por hora — Hoy (${new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'})})`
          : `Tarifas por hora — Mañana (${new Date(Date.now()+86400000).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'})})`;
        document.getElementById('chartTitle').textContent = label;
        hoveredIdx = null;
        state.chartSelIdx = null;
        animateBarChart(prices);
        renderChartInsights(prices);
        updateChartDetail(prices, null);
        renderHeatmap(prices);
        renderBestWindows(prices);
        updateStats(prices);
        drawGauge(state.activeTab === 'today' ? state.todayPrices : prices);
        renderSlotWidget();
      }
    });
  });
}

// ─── RESIZE ──────────────────────────────────────────────────────────────────
function resizeCanvases() {
  // Each canvas self-sizes to its container (Hi-DPI aware), so just redraw.
  drawBarChart(activePrices(), 1);
  drawRadialClock(state.todayPrices);
  drawGauge(state.todayPrices);

  // Compare chart: redraw to current width while the compare tab is active
  if (state.activeTab === 'compare' && state.comparePrices?.length && state.todayPrices?.length) {
    drawCompareChart();
  }
}

// ─── RENDER ALL ──────────────────────────────────────────────────────────────
function renderAll() {
  updateCurrentPrice();
  updateStats(state.todayPrices);
  drawRadialClock(state.todayPrices);
  animateBarChart(state.todayPrices);
  renderChartInsights(state.todayPrices);
  updateChartDetail(state.todayPrices, state.chartSelIdx);
  renderHeatmap(state.todayPrices);
  renderBestWindows(state.todayPrices);
  drawGauge(state.todayPrices);
  // NOTE: renderSlotWidget must accompany all price series updates to stay in sync
  renderSlotWidget();
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  initTabs();
  // initAlarm(); // Disabled - alarm widget removed
  initPlanner();
  initSlotWidget();
  initCalcModal();
  bindBarChartEvents();
  initChartModes();
  initHistory();
  initCompare();

  await loadPrices();
  renderAll();

  window.addEventListener('resize', () => {
    clearTimeout(window._rt);
    window._rt = setTimeout(resizeCanvases, 150);
  });
  setTimeout(resizeCanvases, 80);

  setInterval(async () => { await loadPrices(); renderAll(); }, 5*60*1000);
  setInterval(() => {
    // Midnight rollover: when the local day changes, reload so "Hoy" tracks the
    // real current day (prices are otherwise fetched for the day the page loaded on).
    if (state.loadedDayStr && getTodayStr() !== state.loadedDayStr) {
      loadPrices().then(renderAll);
    }
    updateCurrentPrice();
    drawRadialClock(state.todayPrices);
  }, 60*1000);
}

document.addEventListener('DOMContentLoaded', init);