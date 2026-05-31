// ── 종목 이름 맵
const STOCK_MAP = {
  '삼성전자': '005930', '현대차': '005380', '현대자동차': '005380',
  '기아': '000270', 'NAVER': '035420', '네이버': '035420',
  'LG화학': '051910', '삼성SDI': '006400', 'SK하이닉스': '000660',
  '카카오': '035720', 'LG전자': '066570', '씨에스윈드': '100790',
  '현대모비스': '012330', 'POSCO홀딩스': '005490', 'KB금융': '105560',
  '신한지주': '055550', '삼성바이오로직스': '207940', '셀트리온': '068270',
  '카카오뱅크': '323410', '크래프톤': '259960', '하이브': '352820',
  'LG에너지솔루션': '373220', '하나금융지주': '086790', '우리금융지주': '316140',
  '메리츠금융지주': '138040', '삼성화재': '000810', 'SK텔레콤': '017670',
  'KT': '030200', 'KT&G': '033780', '에코프로비엠': '247540',
  '에코프로': '086520', 'HLB': '028300', '펄어비스': '263750',
  '카카오게임즈': '293490', '위메이드': '112040', '클래시스': '214150',
  '리노공업': '058470', '파마리서치': '214450', '알테오젠': '196170',
};

// ── 서버 API 호출
const api = {
  getState:     () => fetch('/api/state').then(r => r.json()),
  setState:     (data) => fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  getStock:     (code, range) => fetch(`/api/stock/${code}?range=${range || '1mo'}`).then(r => r.json()),
  startBot:     () => fetch('/api/bot/start', { method: 'POST' }).then(r => r.json()),
  stopBot:      () => fetch('/api/bot/stop', { method: 'POST' }).then(r => r.json()),
  getBotLog:    () => fetch('/api/bot/log').then(r => r.json()),
  getStats:     () => fetch('/api/stats').then(r => r.json()),
  saveConfig:   (cfg) => fetch('/api/bot/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }).then(r => r.json()),
  getWatchlist: () => fetch('/api/watchlist').then(r => r.json()),
  saveWatchlist:(list) => fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchlist: list }) }),
};

// ── 앱 상태 (UI용)
let state = {
  cash: 1000000, initialCash: 1000000,
  portfolio: {}, history: [], botLog: [],
  botRunning: false,
  currentStock: null, currentPrice: 0,
  chartInstance: null,
};

let watchlist = [];

function fmt(n) { return Math.round(n).toLocaleString('ko-KR') + ' 원'; }

function resolveCode(input) {
  const t = input.trim();
  if (STOCK_MAP[t]) return STOCK_MAP[t];
  if (STOCK_MAP[t.toUpperCase()]) return STOCK_MAP[t.toUpperCase()];
  if (/^\d{6}$/.test(t)) return t;
  return null;
}

// ── 서버에서 상태 동기화
async function syncState() {
  const s = await api.getState();
  state.cash = s.cash;
  state.initialCash = s.initialCash;
  state.portfolio = s.portfolio;
  state.history = s.history;
  state.botLog = s.botLog || [];
  state.botRunning = s.botRunning;
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  renderBotLog();
  updateBotButton(s.botRunning);

  if (s.botConfig) syncBotConfigUI(s.botConfig);
  loadStats();
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

// ── 성과 분석
async function loadStats() {
  try {
    const s = await api.getStats();
    document.getElementById('stat-trades').textContent = s.totalTrades;
    document.getElementById('stat-winrate').textContent = s.winRate !== null ? s.winRate.toFixed(1) + '%' : '-';

    const profitEl = document.getElementById('stat-profit');
    const p = Math.round(s.totalProfit);
    profitEl.textContent = (p > 0 ? '+' : '') + p.toLocaleString() + '원';
    profitEl.className = 'value ' + (p >= 0 ? 'positive' : 'negative');

    document.getElementById('stat-mdd').textContent = s.maxDrawdown.toFixed(1) + '%';

    if (s.valueHistory && s.valueHistory.length > 1) renderPerfChart(s.valueHistory);
  } catch (e) { /* ignore */ }
}

function renderPerfChart(valueHistory) {
  const canvas = document.getElementById('perf-chart');
  const emptyMsg = document.getElementById('perf-empty');
  canvas.style.display = 'block';
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (window.perfChartInstance) window.perfChartInstance.destroy();
  window.perfChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: valueHistory.map(v => v.date),
      datasets: [{ data: valueHistory.map(v => v.value), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true }],
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

// ── 봇 로그
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

function updateBotButton(running) {
  const btn = document.getElementById('btn-bot-toggle');
  if (!btn) return;
  state.botRunning = running;
  btn.textContent = running ? '⏹ 봇 정지' : '🤖 봇 시작';
  btn.classList.toggle('running', running);
}

// ── 봇 설정 UI 동기화
function syncBotConfigUI(cfg) {
  document.getElementById('cfg-profit').value = (cfg.profitTarget * 100).toFixed(1);
  document.getElementById('cfg-stoploss').value = (cfg.stopLoss * 100).toFixed(1);
  document.getElementById('cfg-buyratio').value = (cfg.buyPerStock * 100).toFixed(0);
  document.getElementById('cfg-interval').value = cfg.intervalMin;
  updateBotDesc(cfg.profitTarget, cfg.stopLoss, cfg.intervalMin);
}

function updateBotDesc(profitTarget, stopLoss, intervalMin) {
  document.getElementById('bot-desc').textContent =
    `수익 +${(profitTarget * 100).toFixed(1)}% 자동매도 · 손실 -${(stopLoss * 100).toFixed(1)}% 손절 · ${intervalMin}분마다 종목 탐색`;
}

// ── 관심 종목
async function loadWatchlist() {
  try {
    const data = await api.getWatchlist();
    watchlist = data.watchlist || [];
    renderWatchlistTab();
  } catch (e) {}
}

function updateStarButton() {
  const btn = document.getElementById('btn-star');
  if (!btn || !state.currentStock) return;
  const isWatched = watchlist.some(w => w.code === state.currentStock.shortCode);
  btn.textContent = isWatched ? '★' : '☆';
  btn.classList.toggle('active', isWatched);
}

function renderWatchlistTab() {
  const container = document.getElementById('watchlist-items');
  const emptyMsg = document.getElementById('watchlist-empty');
  if (!watchlist.length) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';
  container.innerHTML = watchlist.map(w =>
    `<button class="btn-quick" data-code="${w.code}" data-name="${w.name}">${w.name}</button>`
  ).join('');
  container.querySelectorAll('.btn-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('search-input').value = btn.dataset.name;
      loadStock(btn.dataset.name);
    });
  });
}

// ── 차트
function renderChart(prices) {
  const ctx = document.getElementById('price-chart').getContext('2d');
  if (state.chartInstance) state.chartInstance.destroy();
  const data = prices.map(p => p.price);
  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: prices.map(p => p.date),
      datasets: [{ data, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true }],
    },
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

// ── AI 분석
function analyzeStock(prices, currentPrice) {
  if (prices.length < 5) return { signal: 'hold', reasons: ['데이터 부족'], change1d: 0, change30d: 0 };
  const all = prices.map(p => p.price);
  const ma5 = all.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = all.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, all.length);
  const change1d = prices.length >= 2 ? ((currentPrice - prices[prices.length - 2].price) / prices[prices.length - 2].price * 100) : 0;
  const change30d = ((currentPrice - all[0]) / all[0]) * 100;
  let score = 0; const reasons = [];
  if (currentPrice > ma5) { score++; reasons.push(`현재가가 5일 평균(${Math.round(ma5).toLocaleString()}) 위`); } else { score--; reasons.push('현재가가 5일 평균 아래'); }
  if (ma5 > ma20) { score++; reasons.push('골든크로스 — 단기 평균이 중기 평균 위'); } else { score--; reasons.push('데드크로스 — 단기 평균이 중기 평균 아래'); }
  if (change30d > 5) { score++; reasons.push(`한 달 +${change30d.toFixed(1)}%`); } else if (change30d < -5) { score--; reasons.push(`한 달 ${change30d.toFixed(1)}%`); }
  return { signal: score >= 2 ? 'buy' : score <= -2 ? 'sell' : 'hold', reasons, change1d, change30d };
}

function showAnalysis(analysis) {
  const signalText = { buy: '📈 매수 추천', sell: '📉 매도 추천', hold: '⏸ 관망 추천' };
  document.getElementById('ai-content').innerHTML = `
    <p class="signal ${analysis.signal}">${signalText[analysis.signal]}</p>
    <p><strong>분석 근거:</strong></p>
    <ul style="margin:8px 0 12px 16px;color:#9ca3af;">${analysis.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
    <p>전일 대비: <strong style="color:${analysis.change1d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change1d >= 0 ? '+' : ''}${(analysis.change1d||0).toFixed(2)}%</strong>
    &nbsp;| 1개월: <strong style="color:${analysis.change30d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change30d >= 0 ? '+' : ''}${analysis.change30d.toFixed(2)}%</strong></p>
    <p style="margin-top:10px;font-size:0.75rem;color:#4b5563;">※ AI 분석은 참고용입니다.</p>`;
  document.getElementById('ai-actions').style.display = 'flex';
  const buyBtn = document.getElementById('btn-buy');
  const code = state.currentStock?.shortCode;
  if (analysis.signal === 'sell' && code && state.portfolio[code]) {
    buyBtn.textContent = '📉 매도하기'; buyBtn.onclick = () => openSellModal(code);
  } else {
    buyBtn.textContent = '✅ 매수하기'; buyBtn.onclick = openBuyModal;
  }
}

// ── 종목 로드
async function loadStock(input) {
  const detail = document.getElementById('stock-detail');
  detail.style.display = 'block';
  document.getElementById('stock-name').textContent = '로딩 중...';
  document.getElementById('current-price').textContent = '-';
  document.getElementById('price-change').textContent = '';
  document.getElementById('ai-content').innerHTML = '<p class="loading">서버에서 데이터 조회 중...</p>';
  document.getElementById('ai-actions').style.display = 'none';

  const shortCode = resolveCode(input);
  if (!shortCode) { document.getElementById('ai-content').innerHTML = '<p class="loading">종목을 찾을 수 없습니다.</p>'; return; }

  try {
    const data = await api.getStock(shortCode);
    if (data.error) throw new Error(data.error);
    state.currentStock = { ...data, shortCode };
    state.currentPrice = data.currentPrice;

    const change = data.currentPrice - data.prevClose;
    const changePct = (change / data.prevClose) * 100;
    document.getElementById('stock-name').textContent = data.name;
    document.getElementById('stock-code').textContent = shortCode;
    document.getElementById('current-price').textContent = data.currentPrice.toLocaleString() + ' 원';
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${Math.round(change).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    renderChart(data.prices);
    showAnalysis(analyzeStock(data.prices, data.currentPrice));
    updateStarButton();
  } catch (e) {
    document.getElementById('ai-content').innerHTML = `<p class="loading">조회 실패: ${e.message}</p>`;
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
  state.currentStock = { code, shortCode: code, name: pos.name };
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
async function executeBuy() {
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
  await api.setState({ cash: state.cash, portfolio: state.portfolio, history: state.history });
  await fetch('/api/snapshot', { method: 'POST' });
  updateBalanceUI(); renderPortfolio(); renderHistory(); loadStats();
  document.getElementById('modal-buy').style.display = 'none';
}

// ── 매도 실행
async function executeSell() {
  const code = state.currentStock.shortCode || state.currentStock.code;
  const pos = state.portfolio[code];
  if (!pos) return;
  const qty = parseInt(document.getElementById('sell-qty').value);
  if (qty <= 0 || qty > pos.qty) { alert('수량을 확인하세요.'); return; }
  const profit = Math.round((state.currentPrice - pos.avgPrice) * qty);
  state.cash += qty * state.currentPrice;
  pos.qty -= qty;
  if (pos.qty === 0) delete state.portfolio[code];
  state.history.push({ type: 'sell', name: pos.name, qty, price: state.currentPrice, profit, date: new Date().toLocaleDateString('ko-KR') });
  await api.setState({ cash: state.cash, portfolio: state.portfolio, history: state.history });
  await fetch('/api/snapshot', { method: 'POST' });
  updateBalanceUI(); renderPortfolio(); renderHistory(); loadStats();
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
      const rangeMap = { 30: '1mo', 90: '3mo', 180: '6mo' };
      const data = await api.getStock(state.currentStock.shortCode, rangeMap[tab.dataset.period]);
      if (!data.error) renderChart(data.prices);
    }
  });
});

// 관심 종목 별 버튼
document.getElementById('btn-star').addEventListener('click', async () => {
  if (!state.currentStock) return;
  const { shortCode: code, name } = state.currentStock;
  const idx = watchlist.findIndex(w => w.code === code);
  if (idx >= 0) watchlist.splice(idx, 1);
  else watchlist.push({ code, name });
  await api.saveWatchlist(watchlist);
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
document.getElementById('btn-confirm-charge').addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('charge-amount').value);
  if (amount < 100000) { alert('최소 10만원 이상'); return; }
  if (!confirm(`${amount.toLocaleString()}원으로 초기화합니다. 기존 데이터가 삭제됩니다.`)) return;
  state.cash = amount; state.initialCash = amount; state.portfolio = {}; state.history = [];
  await api.setState({ cash: amount, initialCash: amount, portfolio: {}, history: [] });
  updateBalanceUI(); renderPortfolio(); renderHistory();
  document.getElementById('modal-charge').style.display = 'none';
});
document.getElementById('btn-cancel-charge').addEventListener('click', () => { document.getElementById('modal-charge').style.display = 'none'; });

// 봇 토글
document.getElementById('btn-bot-toggle').addEventListener('click', async () => {
  if (state.botRunning) {
    await api.stopBot(); updateBotButton(false);
  } else {
    await api.startBot(); updateBotButton(true);
  }
  setTimeout(syncState, 2000);
});

// 봇 설정 저장
document.getElementById('btn-save-config').addEventListener('click', async () => {
  const profitTarget = parseFloat(document.getElementById('cfg-profit').value) / 100;
  const stopLoss = parseFloat(document.getElementById('cfg-stoploss').value) / 100;
  const buyPerStock = parseFloat(document.getElementById('cfg-buyratio').value) / 100;
  const intervalMin = parseInt(document.getElementById('cfg-interval').value);

  await api.saveConfig({ profitTarget, stopLoss, buyPerStock, intervalMin });
  updateBotDesc(profitTarget, stopLoss, intervalMin);

  if (state.botRunning) {
    await api.stopBot();
    setTimeout(async () => { await api.startBot(); updateBotButton(true); }, 500);
  }

  const btn = document.getElementById('btn-save-config');
  btn.textContent = '✓ 저장됨';
  setTimeout(() => { btn.textContent = '설정 저장'; }, 1500);
});

// 모달 오버레이 클릭 시 닫기
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
});

// ── 한국 장 시간 판단 (KST 09:00~15:30, 월~금)
function isKoreanMarketOpen() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return totalMin >= 9 * 60 && totalMin < 15 * 60 + 30;
}

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

let priceRefreshTimer = null;

async function refreshCurrentPrice() {
  if (!state.currentStock) return;
  try {
    const data = await api.getStock(state.currentStock.shortCode);
    if (data.error) return;
    state.currentPrice = data.currentPrice;
    state.currentStock.currentPrice = data.currentPrice;
    const change = data.currentPrice - data.prevClose;
    const changePct = (change / data.prevClose) * 100;
    document.getElementById('current-price').textContent = data.currentPrice.toLocaleString() + ' 원';
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${Math.round(change).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
  } catch (e) { /* silent */ }
}

function startPriceRefresh() {
  if (priceRefreshTimer) clearInterval(priceRefreshTimer);
  updateMarketStatus();
  priceRefreshTimer = setInterval(() => {
    updateMarketStatus();
    if (isKoreanMarketOpen()) refreshCurrentPrice();
  }, 60 * 1000);
}

// 초기화
syncState();
loadWatchlist();
startPriceRefresh();
setInterval(syncState, 30000);
