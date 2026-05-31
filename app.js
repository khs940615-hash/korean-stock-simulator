// ── 종목 맵 (한글명 → Yahoo 코드)
const STOCK_MAP = {
  // KOSPI 대형
  '삼성전자': '005930.KS', 'SK하이닉스': '000660.KS', 'LG에너지솔루션': '373220.KS',
  '삼성바이오로직스': '207940.KS', '현대차': '005380.KS', '현대자동차': '005380.KS',
  '기아': '000270.KS', '기아차': '000270.KS', 'POSCO홀딩스': '005490.KS',
  'LG화학': '051910.KS', '삼성SDI': '006400.KS', 'LG전자': '066570.KS',
  '현대모비스': '012330.KS', '씨에스윈드': '100790.KS', '셀트리온': '068270.KS',
  'SK이노베이션': '096770.KS', '두산에너빌리티': '034020.KS', '한국전력': '015760.KS',
  '한화에어로스페이스': '012450.KS',
  // 금융
  'KB금융': '105560.KS', '신한지주': '055550.KS', '하나금융지주': '086790.KS',
  '우리금융지주': '316140.KS', '메리츠금융지주': '138040.KS', '삼성화재': '000810.KS',
  // IT·플랫폼
  'NAVER': '035420.KS', 'naver': '035420.KS', '네이버': '035420.KS',
  '카카오': '035720.KS', '카카오뱅크': '323410.KS', '크래프톤': '259960.KS',
  '하이브': '352820.KS', 'SK텔레콤': '017670.KS', 'KT': '030200.KS', 'KT&G': '033780.KS',
  // KOSDAQ
  '에코프로비엠': '247540.KQ', '에코프로': '086520.KQ', 'HLB': '028300.KQ',
  '펄어비스': '263750.KQ', '카카오게임즈': '293490.KQ', '위메이드': '112040.KQ',
  '클래시스': '214150.KQ', '리노공업': '058470.KQ', '파마리서치': '214450.KQ',
  '알테오젠': '196170.KQ',
};

const CODE_TO_NAME = {};
Object.entries(STOCK_MAP).forEach(([name, yahoo]) => {
  const code = yahoo.replace('.KS', '').replace('.KQ', '');
  if (!CODE_TO_NAME[code]) CODE_TO_NAME[code] = name;
});

// ── CORS 프록시 (순서대로 시도)
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// ── Mock 데이터 (API 전부 실패 시 fallback)
function generateMockPrices(basePrice, days) {
  const prices = [];
  let price = basePrice * (0.85 + Math.random() * 0.1);
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    price = price * (1 + (Math.random() - 0.48) * 0.03);
    const d = new Date(now - i * 86400000);
    if (d.getDay() !== 0 && d.getDay() !== 6)
      prices.push({ date: d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }), price: Math.round(price) });
  }
  return prices;
}

const MOCK_DATA = {
  '005930': { name: '삼성전자', price: 74000 },
  '000660': { name: 'SK하이닉스', price: 195000 },
  '005380': { name: '현대차', price: 235000 },
  '000270': { name: '기아', price: 98000 },
  '035420': { name: 'NAVER', price: 195000 },
  '051910': { name: 'LG화학', price: 310000 },
  '006400': { name: '삼성SDI', price: 280000 },
  '035720': { name: '카카오', price: 48000 },
  '100790': { name: '씨에스윈드', price: 62000 },
  '066570': { name: 'LG전자', price: 88000 },
  '068270': { name: '셀트리온', price: 168000 },
  '105560': { name: 'KB금융', price: 78000 },
  '247540': { name: '에코프로비엠', price: 95000 },
  '086520': { name: '에코프로', price: 58000 },
  '028300': { name: 'HLB', price: 42000 },
};

// ── 봇 감시 종목
const BOT_WATCHLIST = [
  '005930', '000660', '373220', '005380', '000270',
  '035420', '035720', '066570', '051910', '006400',
  '068270', '100790', '247540', '086520', '028300',
];

// ── 기본 봇 설정
const DEFAULT_BOT_CONFIG = { profitTarget: 0.03, stopLoss: 0.05, buyPerStock: 0.15, intervalMin: 30 };

// ── 앱 상태
let state = {
  cash: 1000000, initialCash: 1000000,
  portfolio: {}, history: [], botLog: [],
  botRunning: false, botTimer: null,
  currentStock: null, currentPrice: 0,
  chartInstance: null, chartPrices: [],
  botConfig: { ...DEFAULT_BOT_CONFIG },
  watchlist: [],
  valueHistory: [],
};

// ── localStorage 저장/불러오기
function saveState() {
  localStorage.setItem('stock-sim', JSON.stringify({
    cash: state.cash, initialCash: state.initialCash,
    portfolio: state.portfolio, history: state.history,
    botLog: state.botLog.slice(-50),
    botConfig: state.botConfig,
    watchlist: state.watchlist,
    valueHistory: state.valueHistory.slice(-100),
  }));
}

function loadState() {
  const saved = localStorage.getItem('stock-sim');
  if (!saved) return;
  const d = JSON.parse(saved);
  state.cash = d.cash;
  state.initialCash = d.initialCash;
  state.portfolio = d.portfolio;
  state.history = d.history;
  state.botLog = d.botLog || [];
  state.botConfig = { ...DEFAULT_BOT_CONFIG, ...(d.botConfig || {}) };
  state.watchlist = d.watchlist || [];
  state.valueHistory = d.valueHistory || [];
}

// ── 총 자산 계산
function getTotalValue() {
  let stockVal = 0;
  Object.values(state.portfolio).forEach(p => { stockVal += p.qty * (p.lastPrice || p.avgPrice); });
  return state.cash + stockVal;
}

// ── 자산 스냅샷 (매수·매도 시 호출)
function recordValueSnapshot() {
  const label = new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    + ' ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.valueHistory.push({ date: label, value: Math.round(getTotalValue()) });
  if (state.valueHistory.length > 100) state.valueHistory.shift();
}

// ── 성과 통계 계산
function calcStats() {
  const sells = state.history.filter(h => h.type === 'sell' && h.profit !== undefined);
  const totalTrades = sells.length;
  const winTrades = sells.filter(h => h.profit > 0).length;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : null;
  const totalProfit = sells.reduce((s, h) => s + h.profit, 0);

  let maxDrawdown = 0;
  if (state.valueHistory.length > 1) {
    let peak = state.valueHistory[0].value;
    for (const { value } of state.valueHistory) {
      if (value > peak) peak = value;
      const dd = peak > 0 ? (value - peak) / peak : 0;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }
  return { totalTrades, winRate, totalProfit, maxDrawdown: maxDrawdown * 100 };
}

function renderStats() {
  const s = calcStats();
  document.getElementById('stat-trades').textContent = s.totalTrades;
  document.getElementById('stat-winrate').textContent = s.winRate !== null ? s.winRate.toFixed(1) + '%' : '-';

  const profitEl = document.getElementById('stat-profit');
  const p = Math.round(s.totalProfit);
  profitEl.textContent = (p > 0 ? '+' : '') + p.toLocaleString() + '원';
  profitEl.className = 'value ' + (p >= 0 ? 'positive' : 'negative');

  document.getElementById('stat-mdd').textContent = s.maxDrawdown.toFixed(1) + '%';

  if (state.valueHistory.length > 1) renderPerfChart();
}

function renderPerfChart() {
  const canvas = document.getElementById('perf-chart');
  const emptyMsg = document.getElementById('perf-empty');
  canvas.style.display = 'block';
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (window.perfChartInstance) window.perfChartInstance.destroy();
  const vh = state.valueHistory;
  window.perfChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: vh.map(v => v.date),
      datasets: [{ data: vh.map(v => v.value), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toLocaleString() + '원' } } },
      scales: {
        x: { ticks: { color: '#6b7280', maxTicksLimit: 5 }, grid: { color: '#1e2130' } },
        y: { ticks: { color: '#6b7280', callback: v => v.toLocaleString() }, grid: { color: '#1e2130' } },
      },
    },
  });
}

// ── 관심 종목
function updateStarButton() {
  const btn = document.getElementById('btn-star');
  if (!btn || !state.currentStock) return;
  const code = state.currentStock.shortCode;
  const isWatched = state.watchlist.some(w => w.code === code);
  btn.textContent = isWatched ? '★' : '☆';
  btn.classList.toggle('active', isWatched);
}

function renderWatchlistTab() {
  const container = document.getElementById('watchlist-items');
  const emptyMsg = document.getElementById('watchlist-empty');
  if (!state.watchlist.length) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';
  container.innerHTML = state.watchlist.map(w =>
    `<button class="btn-quick" data-name="${w.name}">${w.name}</button>`
  ).join('');
  container.querySelectorAll('.btn-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('search-input').value = btn.dataset.name;
      loadStock(btn.dataset.name);
    });
  });
}

// ── 봇 설정 UI 동기화
function syncBotConfigUI() {
  const cfg = state.botConfig;
  document.getElementById('cfg-profit').value = (cfg.profitTarget * 100).toFixed(1);
  document.getElementById('cfg-stoploss').value = (cfg.stopLoss * 100).toFixed(1);
  document.getElementById('cfg-buyratio').value = (cfg.buyPerStock * 100).toFixed(0);
  document.getElementById('cfg-interval').value = cfg.intervalMin;
  updateBotDesc();
}

function updateBotDesc() {
  const cfg = state.botConfig;
  document.getElementById('bot-desc').textContent =
    `수익 +${(cfg.profitTarget * 100).toFixed(1)}% 자동매도 · 손실 -${(cfg.stopLoss * 100).toFixed(1)}% 손절 · ${cfg.intervalMin}분마다 종목 탐색`;
}

// ── 봇 로그
function addBotLog(emoji, msg, type = 'info') {
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.botLog.unshift({ time, msg: emoji + ' ' + msg, type });
  if (state.botLog.length > 50) state.botLog.pop();
  renderBotLog();
}

function renderBotLog() {
  const container = document.getElementById('bot-log');
  if (!container) return;
  if (!state.botLog.length) { container.innerHTML = '<p class="empty-msg">봇 활동 내역이 없습니다.</p>'; return; }
  container.innerHTML = state.botLog.map(l => `
    <div class="bot-log-item ${l.type}">
      <span class="log-time">${l.time}</span>
      <span class="log-msg">${l.msg}</span>
    </div>`).join('');
}

// ── 봇: 보유 주식 점검
async function botCheckPortfolio() {
  const cfg = state.botConfig;
  for (const [code, pos] of Object.entries(state.portfolio)) {
    try {
      const yahooCode = CODE_TO_NAME[code] ? STOCK_MAP[CODE_TO_NAME[code]] : code + '.KS';
      const data = await fetchStockData(yahooCode, 30);
      const cur = data.currentPrice;
      pos.lastPrice = cur;
      const ret = (cur - pos.avgPrice) / pos.avgPrice;

      if (ret >= cfg.profitTarget) {
        const profit = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, profit, date: new Date().toLocaleDateString('ko-KR') });
        addBotLog('📈', `${pos.name} ${pos.qty}주 매도 +${(ret*100).toFixed(1)}% (+${profit.toLocaleString()}원)`, 'sell');
        delete state.portfolio[code];
        recordValueSnapshot();
      } else if (ret <= -cfg.stopLoss) {
        const profit = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, profit, date: new Date().toLocaleDateString('ko-KR') });
        addBotLog('🛑', `${pos.name} 손절 ${(ret*100).toFixed(1)}% (${profit.toLocaleString()}원)`, 'loss');
        delete state.portfolio[code];
        recordValueSnapshot();
      } else {
        addBotLog('👀', `${pos.name} 보유 중 ${ret >= 0 ? '+' : ''}${(ret*100).toFixed(1)}% — 대기`, 'info');
      }
    } catch (e) {
      addBotLog('⚠️', `${pos.name} 가격 조회 실패`, 'warn');
    }
  }
}

// ── 봇: 신규 종목 탐색
async function botScanAndBuy() {
  const cfg = state.botConfig;
  const held = Object.keys(state.portfolio);
  for (const code of BOT_WATCHLIST.filter(c => !held.includes(c))) {
    if (state.cash < 50000) break;
    try {
      const yahooCode = STOCK_MAP[CODE_TO_NAME[code]] || code + '.KS';
      const data = await fetchStockData(yahooCode, 30);
      const analysis = analyzeStock(data.prices, data.currentPrice);
      if (analysis.signal !== 'buy') continue;

      const qty = Math.max(1, Math.floor(state.cash * cfg.buyPerStock / data.currentPrice));
      const total = qty * data.currentPrice;
      if (total > state.cash) continue;

      state.cash -= total;
      state.portfolio[code] = { name: data.name, qty, avgPrice: data.currentPrice, lastPrice: data.currentPrice };
      state.history.push({ type: 'buy', name: data.name, qty, price: data.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
      addBotLog('✅', `${data.name} ${qty}주 매수 @ ${data.currentPrice.toLocaleString()}원`, 'buy');
      recordValueSnapshot();
      break;
    } catch (e) { /* skip */ }
  }
}

// ── 봇 1회 사이클
async function botCycle() {
  addBotLog('🤖', '분석 시작...', 'info');
  await botCheckPortfolio();
  await botScanAndBuy();
  saveState();
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  renderStats();
  addBotLog('✔', `사이클 완료 — 다음 실행 ${state.botConfig.intervalMin}분 후`, 'info');
}

// ── 한국 장 시간 판단 (KST 09:00~15:30, 월~금)
function isKoreanMarketOpen() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return totalMin >= 9 * 60 && totalMin < 15 * 60 + 30;
}

// ── 장 상태 배지 업데이트
function updateMarketStatus() {
  const el = document.getElementById('market-status');
  if (!el) return;
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (isKoreanMarketOpen()) {
    el.textContent = '🔵 장 중 (15분 지연)';
    el.className = 'market-badge open';
  } else if (day >= 1 && day <= 5 && totalMin >= 8 * 60 && totalMin < 9 * 60) {
    el.textContent = '🟡 장 전';
    el.className = 'market-badge pre';
  } else {
    el.textContent = '🔴 장 마감';
    el.className = 'market-badge closed';
  }
}

// ── 현재 종목 가격 자동 갱신
let priceRefreshTimer = null;

async function refreshCurrentPrice() {
  if (!state.currentStock || state.currentStock.isMock) return;
  try {
    const code = state.currentStock.code || state.currentStock.shortCode;
    const data = await fetchStockData(code, 30);
    if (!data || data.isMock) return;

    state.currentPrice = data.currentPrice;
    state.currentStock.currentPrice = data.currentPrice;
    state.currentStock.prevClose = data.prevClose;

    if (state.portfolio[data.shortCode]) {
      state.portfolio[data.shortCode].lastPrice = data.currentPrice;
    }

    const change = data.currentPrice - data.prevClose;
    const changePct = (change / data.prevClose) * 100;
    document.getElementById('current-price').textContent = data.currentPrice.toLocaleString() + ' 원';
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${Math.round(change).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');

    updateBalanceUI();
    renderPortfolio();
    saveState();
  } catch (e) { /* silent */ }
}

function startPriceRefresh() {
  stopPriceRefresh();
  updateMarketStatus();
  priceRefreshTimer = setInterval(() => {
    updateMarketStatus();
    if (isKoreanMarketOpen()) refreshCurrentPrice();
  }, 60 * 1000);
}

function stopPriceRefresh() {
  if (priceRefreshTimer) { clearInterval(priceRefreshTimer); priceRefreshTimer = null; }
}

// ── 봇 시작/정지
function startBot() {
  if (state.botRunning) return;
  state.botRunning = true;
  const ms = state.botConfig.intervalMin * 60 * 1000;
  addBotLog('🚀', `자동매매 봇 시작! ${state.botConfig.intervalMin}분마다 종목 점검`, 'info');
  botCycle();
  state.botTimer = setInterval(botCycle, ms);
  document.getElementById('btn-bot-toggle').textContent = '⏹ 봇 정지';
  document.getElementById('btn-bot-toggle').classList.add('running');
}

function stopBot() {
  if (!state.botRunning) return;
  clearInterval(state.botTimer);
  state.botTimer = null;
  state.botRunning = false;
  addBotLog('⏹', '자동매매 봇 정지됨', 'info');
  document.getElementById('btn-bot-toggle').textContent = '🤖 봇 시작';
  document.getElementById('btn-bot-toggle').classList.remove('running');
}

// ── 숫자 포맷
function fmt(n) { return Math.round(n).toLocaleString('ko-KR') + ' 원'; }

// ── 주가 조회 (프록시 순차 시도 → mock fallback)
async function fetchWithProxy(targetUrl) {
  for (const makeProxy of PROXIES) {
    try {
      const res = await Promise.race([
        fetch(makeProxy(targetUrl)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      if (!res.ok) continue;
      const json = JSON.parse(await res.text());
      if (json?.chart?.result?.[0]) return json;
    } catch (e) {
      console.warn('프록시 실패:', e.message);
    }
  }
  return null;
}

async function fetchStockData(code, period = 30) {
  const yahooCode = code.includes('.') ? code : (STOCK_MAP[code] || code + '.KS');
  const range = period <= 30 ? '1mo' : period <= 90 ? '3mo' : '6mo';
  const json = await fetchWithProxy(`${YF_BASE}${yahooCode}?interval=1d&range=${range}`);
  const shortCode = yahooCode.replace('.KS', '').replace('.KQ', '');

  if (json) {
    const result = json.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const prices = timestamps.map((t, i) => ({
      date: new Date(t * 1000).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
      price: closes[i],
    })).filter(p => p.price != null && !isNaN(p.price));
    return { name: meta.shortName || meta.symbol, code: meta.symbol, shortCode, currentPrice: meta.regularMarketPrice, prevClose: meta.previousClose || meta.chartPreviousClose, prices, isMock: false };
  }

  console.warn('API 실패 — 모의 데이터 사용');
  const mock = MOCK_DATA[shortCode] || { name: shortCode, price: 50000 };
  const prices = generateMockPrices(mock.price, period);
  const currentPrice = prices[prices.length - 1].price;
  return { name: mock.name, code: yahooCode, shortCode, currentPrice, prevClose: prices[prices.length - 2]?.price || currentPrice, prices, isMock: true };
}

// ── 코드 해석
function resolveCode(input) {
  const t = input.trim();
  if (STOCK_MAP[t]) return STOCK_MAP[t];
  if (STOCK_MAP[t.toUpperCase()]) return STOCK_MAP[t.toUpperCase()];
  if (/^\d{6}$/.test(t)) return t + '.KS';
  return null;
}

// ── AI 분석
function analyzeStock(prices, currentPrice) {
  if (prices.length < 5) return { signal: 'hold', reasons: ['데이터 부족'], change1d: 0, change30d: 0 };
  const all = prices.map(p => p.price);
  const ma5 = all.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = all.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, all.length);
  const change1d = prices.length >= 2 ? ((currentPrice - prices[prices.length - 2].price) / prices[prices.length - 2].price * 100) : 0;
  const change30d = ((currentPrice - all[0]) / all[0]) * 100;
  let score = 0; const reasons = [];
  if (currentPrice > ma5) { score++; reasons.push(`현재가(${currentPrice.toLocaleString()})가 5일 평균(${Math.round(ma5).toLocaleString()}) 위`); }
  else { score--; reasons.push('현재가가 5일 평균 아래'); }
  if (ma5 > ma20) { score++; reasons.push('단기 이동평균이 중기 이동평균 돌파 (골든크로스)'); }
  else { score--; reasons.push('단기 이동평균이 중기 이동평균 아래 (데드크로스)'); }
  if (change30d > 5) { score++; reasons.push(`한 달간 +${change30d.toFixed(1)}% 상승`); }
  else if (change30d < -5) { score--; reasons.push(`한 달간 ${change30d.toFixed(1)}% 하락`); }
  return { signal: score >= 2 ? 'buy' : score <= -2 ? 'sell' : 'hold', reasons, change1d, change30d };
}

// ── 잔고 UI
function updateBalanceUI() {
  let stockValue = 0;
  Object.values(state.portfolio).forEach(p => { stockValue += p.qty * (p.lastPrice || p.avgPrice); });
  const total = state.cash + stockValue;
  const ret = ((total - state.initialCash) / state.initialCash) * 100;
  document.getElementById('cash').textContent = fmt(state.cash);
  document.getElementById('stock-value').textContent = fmt(stockValue);
  document.getElementById('total-asset').textContent = fmt(total);
  const el = document.getElementById('total-return');
  el.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
  el.className = 'value ' + (ret >= 0 ? 'positive' : 'negative');
}

// ── 보유 주식
function renderPortfolio() {
  const container = document.getElementById('portfolio-list');
  const entries = Object.entries(state.portfolio);
  if (!entries.length) { container.innerHTML = '<p class="empty-msg">보유 주식이 없습니다.</p>'; return; }
  container.innerHTML = entries.map(([code, pos]) => {
    const cur = pos.lastPrice || pos.avgPrice;
    const profit = ((cur - pos.avgPrice) / pos.avgPrice) * 100;
    const profitAmt = (cur - pos.avgPrice) * pos.qty;
    return `
      <div class="portfolio-item">
        <div>
          <div class="name">${pos.name}</div>
          <div class="qty">${pos.qty}주 · 평균 ${pos.avgPrice.toLocaleString()}원</div>
          <div class="qty">현재 ${cur.toLocaleString()}원</div>
        </div>
        <div style="text-align:right;">
          <div class="profit ${profit >= 0 ? 'pos' : 'neg'}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)}%</div>
          <div class="qty">${profit >= 0 ? '+' : ''}${Math.round(profitAmt).toLocaleString()}원</div>
          <button class="btn-sell" onclick="openSellModal('${code}')">매도</button>
        </div>
      </div>`;
  }).join('');
}

// ── 거래 내역
function renderHistory() {
  const container = document.getElementById('history-list');
  if (!state.history.length) { container.innerHTML = '<p class="empty-msg">거래 내역이 없습니다.</p>'; return; }
  container.innerHTML = [...state.history].reverse().slice(0, 20).map(h => `
    <div class="history-item">
      <span class="type-badge ${h.type}">${h.type === 'buy' ? '매수' : '매도'}</span>
      <span class="h-name">${h.name}</span>
      <span class="h-detail">${h.qty}주 · ${h.price.toLocaleString()}원 · ${h.date}</span>
    </div>`).join('');
}

// ── 차트
function renderChart(prices) {
  const ctx = document.getElementById('price-chart').getContext('2d');
  if (state.chartInstance) state.chartInstance.destroy();
  const data = prices.map(p => p.price);
  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: prices.map(p => p.date), datasets: [{ data, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toLocaleString() + '원' } } },
      scales: {
        x: { ticks: { color: '#6b7280', maxTicksLimit: 6 }, grid: { color: '#1e2130' } },
        y: { ticks: { color: '#6b7280', callback: v => v.toLocaleString() }, grid: { color: '#1e2130' }, min: Math.min(...data) * 0.995, max: Math.max(...data) * 1.005 },
      },
    },
  });
}

// ── AI 분석 표시
function showAnalysis(analysis) {
  const signalText = { buy: '📈 매수 추천', sell: '📉 매도 추천', hold: '⏸ 관망 추천' };
  document.getElementById('ai-content').innerHTML = `
    <p class="signal ${analysis.signal}">${signalText[analysis.signal]}</p>
    <p><strong>분석 근거:</strong></p>
    <ul style="margin:8px 0 12px 16px;color:#9ca3af;">${analysis.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
    <p>전일 대비: <strong style="color:${analysis.change1d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change1d >= 0 ? '+' : ''}${analysis.change1d.toFixed(2)}%</strong>
    &nbsp;| 1개월: <strong style="color:${analysis.change30d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change30d >= 0 ? '+' : ''}${analysis.change30d.toFixed(2)}%</strong></p>
    <p style="margin-top:10px;font-size:0.75rem;color:#4b5563;">※ AI 분석은 참고용입니다. 투자 결정은 본인 판단으로 하세요.</p>`;
  document.getElementById('ai-actions').style.display = 'flex';
  const buyBtn = document.getElementById('btn-buy');
  if (analysis.signal === 'sell' && state.currentStock?.shortCode && state.portfolio[state.currentStock.shortCode]) {
    buyBtn.textContent = '📉 매도하기';
    buyBtn.onclick = () => openSellModal(state.currentStock.shortCode);
  } else {
    buyBtn.textContent = '✅ 매수하기';
    buyBtn.onclick = openBuyModal;
  }
}

// ── 종목 로드
async function loadStock(input) {
  const detail = document.getElementById('stock-detail');
  detail.style.display = 'block';
  document.getElementById('stock-name').textContent = '로딩 중...';
  document.getElementById('current-price').textContent = '-';
  document.getElementById('price-change').textContent = '';
  document.getElementById('ai-content').innerHTML = '<p class="loading">데이터 조회 중... (최대 25초 소요)</p>';
  document.getElementById('ai-actions').style.display = 'none';

  const code = resolveCode(input);
  if (!code) { document.getElementById('ai-content').innerHTML = '<p class="loading">종목을 찾을 수 없습니다. 정확한 종목명 또는 6자리 코드를 입력해주세요.</p>'; return; }

  try {
    const data = await fetchStockData(code, 30);
    state.currentStock = { ...data };
    state.currentPrice = data.currentPrice;
    state.chartPrices = data.prices;

    if (state.portfolio[data.shortCode]) {
      state.portfolio[data.shortCode].lastPrice = data.currentPrice;
      saveState(); updateBalanceUI(); renderPortfolio();
    }

    const change = data.currentPrice - data.prevClose;
    const changePct = (change / data.prevClose) * 100;
    document.getElementById('stock-name').textContent = data.name + (data.isMock ? ' ⚠️ 모의데이터' : '');
    document.getElementById('stock-code').textContent = data.shortCode;
    document.getElementById('current-price').textContent = data.currentPrice.toLocaleString() + ' 원';
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${Math.round(change).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    renderChart(data.prices);
    showAnalysis(analyzeStock(data.prices, data.currentPrice));
    updateStarButton();
  } catch (e) {
    document.getElementById('ai-content').innerHTML = '<p class="loading">데이터 조회 실패. 잠시 후 다시 시도해주세요.</p>';
  }
}

// ── 매수 모달
function openBuyModal() {
  if (!state.currentStock) return;
  document.getElementById('modal-stock-name').textContent = state.currentStock.name;
  document.getElementById('modal-stock-price').textContent = state.currentPrice.toLocaleString() + '원';
  document.getElementById('buy-qty').value = 1;
  updateBuyTotal();
  document.getElementById('modal-buy').style.display = 'flex';
}
function updateBuyTotal() {
  const qty = parseInt(document.getElementById('buy-qty').value) || 0;
  document.getElementById('buy-total').textContent = fmt(qty * state.currentPrice);
  document.getElementById('buy-avail').textContent = fmt(state.cash);
}

// ── 매도 모달
function openSellModal(code) {
  const pos = state.portfolio[code];
  if (!pos) return;
  state.currentStock = { ...state.currentStock, shortCode: code, name: pos.name };
  state.currentPrice = pos.lastPrice || pos.avgPrice;
  document.getElementById('modal-sell-name').textContent = pos.name;
  document.getElementById('modal-sell-price').textContent = state.currentPrice.toLocaleString() + '원';
  document.getElementById('sell-qty').value = 1;
  document.getElementById('sell-avail').textContent = pos.qty + '주';
  updateSellTotal();
  document.getElementById('modal-sell').style.display = 'flex';
}
function updateSellTotal() {
  const qty = parseInt(document.getElementById('sell-qty').value) || 0;
  document.getElementById('sell-total').textContent = fmt(qty * state.currentPrice);
}

// ── 매수 실행
function executeBuy() {
  const qty = parseInt(document.getElementById('buy-qty').value);
  const total = qty * state.currentPrice;
  if (qty <= 0) { alert('수량을 1주 이상 입력하세요.'); return; }
  if (total > state.cash) { alert('현금이 부족합니다.'); return; }
  const code = state.currentStock.shortCode;
  state.cash -= total;
  if (state.portfolio[code]) {
    const pos = state.portfolio[code];
    const newQty = pos.qty + qty;
    pos.avgPrice = (pos.avgPrice * pos.qty + state.currentPrice * qty) / newQty;
    pos.qty = newQty; pos.lastPrice = state.currentPrice;
  } else {
    state.portfolio[code] = { name: state.currentStock.name, qty, avgPrice: state.currentPrice, lastPrice: state.currentPrice };
  }
  state.history.push({ type: 'buy', name: state.currentStock.name, qty, price: state.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
  recordValueSnapshot();
  saveState(); updateBalanceUI(); renderPortfolio(); renderHistory(); renderStats();
  document.getElementById('modal-buy').style.display = 'none';
}

// ── 매도 실행
function executeSell() {
  const code = state.currentStock.shortCode;
  const pos = state.portfolio[code];
  if (!pos) return;
  const qty = parseInt(document.getElementById('sell-qty').value);
  if (qty <= 0) { alert('수량을 1주 이상 입력하세요.'); return; }
  if (qty > pos.qty) { alert('보유 수량을 초과합니다.'); return; }
  const profit = Math.round((state.currentPrice - pos.avgPrice) * qty);
  state.cash += qty * state.currentPrice;
  pos.qty -= qty;
  if (pos.qty === 0) delete state.portfolio[code];
  state.history.push({ type: 'sell', name: pos.name, qty, price: state.currentPrice, profit, date: new Date().toLocaleDateString('ko-KR') });
  recordValueSnapshot();
  saveState(); updateBalanceUI(); renderPortfolio(); renderHistory(); renderStats();
  document.getElementById('modal-sell').style.display = 'none';
}

// ── 이벤트 바인딩

// 검색
document.getElementById('btn-search').addEventListener('click', () => loadStock(document.getElementById('search-input').value));
document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadStock(e.target.value); });

// 종목 탭 전환
document.querySelectorAll('.stock-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stock-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.quick-group').forEach(g => g.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// 빠른 종목 버튼 (정적 탭)
document.querySelectorAll('#tab-kospi .btn-quick, #tab-finance .btn-quick, #tab-it .btn-quick, #tab-kosdaq .btn-quick').forEach(btn => {
  btn.addEventListener('click', () => { document.getElementById('search-input').value = btn.dataset.name; loadStock(btn.dataset.name); });
});

// 차트 기간 탭
document.querySelectorAll('.chart-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (state.currentStock) {
      const data = await fetchStockData(state.currentStock.code || state.currentStock.shortCode, parseInt(tab.dataset.period));
      renderChart(data.prices);
    }
  });
});

// 관심 종목 별 버튼
document.getElementById('btn-star').addEventListener('click', () => {
  if (!state.currentStock) return;
  const { shortCode: code, name } = state.currentStock;
  const idx = state.watchlist.findIndex(w => w.code === code);
  if (idx >= 0) state.watchlist.splice(idx, 1);
  else state.watchlist.push({ code, name });
  saveState();
  updateStarButton();
  renderWatchlistTab();
});

// AI 분석 버튼
document.getElementById('btn-buy').addEventListener('click', openBuyModal);
document.getElementById('btn-skip').addEventListener('click', () => { document.getElementById('ai-actions').style.display = 'none'; });

// 매수 모달
document.getElementById('qty-minus').addEventListener('click', () => { document.getElementById('buy-qty').value = Math.max(1, parseInt(document.getElementById('buy-qty').value) - 1); updateBuyTotal(); });
document.getElementById('qty-plus').addEventListener('click', () => { document.getElementById('buy-qty').value = parseInt(document.getElementById('buy-qty').value) + 1; updateBuyTotal(); });
document.getElementById('buy-qty').addEventListener('input', updateBuyTotal);
document.getElementById('btn-confirm-buy').addEventListener('click', executeBuy);
document.getElementById('btn-cancel-buy').addEventListener('click', () => { document.getElementById('modal-buy').style.display = 'none'; });

// 매도 모달
document.getElementById('sell-qty-minus').addEventListener('click', () => { document.getElementById('sell-qty').value = Math.max(1, parseInt(document.getElementById('sell-qty').value) - 1); updateSellTotal(); });
document.getElementById('sell-qty-plus').addEventListener('click', () => { document.getElementById('sell-qty').value = parseInt(document.getElementById('sell-qty').value) + 1; updateSellTotal(); });
document.getElementById('sell-qty').addEventListener('input', updateSellTotal);
document.getElementById('btn-confirm-sell').addEventListener('click', executeSell);
document.getElementById('btn-cancel-sell').addEventListener('click', () => { document.getElementById('modal-sell').style.display = 'none'; });

// 자금 설정 모달
document.getElementById('btn-charge').addEventListener('click', () => { document.getElementById('modal-charge').style.display = 'flex'; });
document.getElementById('btn-confirm-charge').addEventListener('click', () => {
  const amount = parseInt(document.getElementById('charge-amount').value);
  if (amount < 100000) { alert('최소 10만원 이상 설정해주세요.'); return; }
  if (!confirm(`자금을 ${amount.toLocaleString()}원으로 초기화합니다. 기존 데이터가 삭제됩니다.`)) return;
  state.cash = amount; state.initialCash = amount; state.portfolio = {}; state.history = {}; state.valueHistory = [];
  state.history = [];
  saveState(); updateBalanceUI(); renderPortfolio(); renderHistory(); renderStats();
  document.getElementById('modal-charge').style.display = 'none';
});
document.getElementById('btn-cancel-charge').addEventListener('click', () => { document.getElementById('modal-charge').style.display = 'none'; });

// 봇 토글
document.getElementById('btn-bot-toggle').addEventListener('click', () => {
  if (state.botRunning) stopBot(); else startBot();
});

// 봇 설정 저장
document.getElementById('btn-save-config').addEventListener('click', () => {
  const profitTarget = parseFloat(document.getElementById('cfg-profit').value) / 100;
  const stopLoss = parseFloat(document.getElementById('cfg-stoploss').value) / 100;
  const buyPerStock = parseFloat(document.getElementById('cfg-buyratio').value) / 100;
  const intervalMin = parseInt(document.getElementById('cfg-interval').value);
  state.botConfig = { profitTarget, stopLoss, buyPerStock, intervalMin };
  saveState();
  updateBotDesc();
  if (state.botRunning) {
    clearInterval(state.botTimer);
    state.botTimer = setInterval(botCycle, intervalMin * 60 * 1000);
  }
  const btn = document.getElementById('btn-save-config');
  btn.textContent = '✓ 저장됨';
  setTimeout(() => { btn.textContent = '설정 저장'; }, 1500);
});

// 모달 오버레이 클릭 닫기
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
});

// ── 초기화
loadState();
syncBotConfigUI();
updateBalanceUI();
renderPortfolio();
renderHistory();
renderBotLog();
renderStats();
renderWatchlistTab();
startPriceRefresh();
