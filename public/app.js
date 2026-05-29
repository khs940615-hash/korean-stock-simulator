// ── 종목 이름 맵
const STOCK_MAP = {
  '삼성전자': '005930', '현대차': '005380', '현대자동차': '005380',
  '기아': '000270', 'NAVER': '035420', '네이버': '035420',
  'LG화학': '051910', '삼성SDI': '006400', 'SK하이닉스': '000660',
  '카카오': '035720', 'LG전자': '066570', '씨에스윈드': '100790',
  '현대모비스': '012330', 'POSCO홀딩스': '005490', 'KB금융': '105560',
  '신한지주': '055550', '삼성바이오로직스': '207940', '셀트리온': '068270',
  '카카오뱅크': '323410', '크래프톤': '259960', '하이브': '352820',
};

// ── 서버 API 호출
const api = {
  getState: () => fetch('/api/state').then(r => r.json()),
  setState: (data) => fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  getStock: (code, range) => fetch(`/api/stock/${code}?range=${range || '1mo'}`).then(r => r.json()),
  startBot: () => fetch('/api/bot/start', { method: 'POST' }).then(r => r.json()),
  stopBot: () => fetch('/api/bot/stop', { method: 'POST' }).then(r => r.json()),
  getBotLog: () => fetch('/api/bot/log').then(r => r.json()),
};

// ── 앱 상태 (UI용)
let state = {
  cash: 1000000, initialCash: 1000000,
  portfolio: {}, history: [], botLog: [],
  botRunning: false,
  currentStock: null, currentPrice: 0,
  chartInstance: null,
};

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
  updateBalanceUI(); renderPortfolio(); renderHistory();
  document.getElementById('modal-buy').style.display = 'none';
}

// ── 매도 실행
async function executeSell() {
  const code = state.currentStock.shortCode || state.currentStock.code;
  const pos = state.portfolio[code];
  if (!pos) return;
  const qty = parseInt(document.getElementById('sell-qty').value);
  if (qty <= 0 || qty > pos.qty) { alert('수량을 확인하세요.'); return; }
  state.cash += qty * state.currentPrice;
  pos.qty -= qty;
  if (pos.qty === 0) delete state.portfolio[code];
  state.history.push({ type: 'sell', name: pos.name, qty, price: state.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
  await api.setState({ cash: state.cash, portfolio: state.portfolio, history: state.history });
  updateBalanceUI(); renderPortfolio(); renderHistory();
  document.getElementById('modal-sell').style.display = 'none';
}

// ── 이벤트 바인딩
document.getElementById('btn-search').addEventListener('click', () => loadStock(document.getElementById('search-input').value));
document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadStock(e.target.value); });
document.querySelectorAll('.btn-quick').forEach(btn => {
  btn.addEventListener('click', () => { document.getElementById('search-input').value = btn.dataset.name; loadStock(btn.dataset.name); });
});
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

document.getElementById('btn-buy').addEventListener('click', openBuyModal);
document.getElementById('btn-skip').addEventListener('click', () => { document.getElementById('ai-actions').style.display = 'none'; });

document.getElementById('qty-minus').addEventListener('click', () => { document.getElementById('buy-qty').value = Math.max(1, parseInt(document.getElementById('buy-qty').value) - 1); updateBuyTotal(); });
document.getElementById('qty-plus').addEventListener('click', () => { document.getElementById('buy-qty').value = parseInt(document.getElementById('buy-qty').value) + 1; updateBuyTotal(); });
document.getElementById('buy-qty').addEventListener('input', updateBuyTotal);
document.getElementById('btn-confirm-buy').addEventListener('click', executeBuy);
document.getElementById('btn-cancel-buy').addEventListener('click', () => { document.getElementById('modal-buy').style.display = 'none'; });

document.getElementById('sell-qty-minus').addEventListener('click', () => { document.getElementById('sell-qty').value = Math.max(1, parseInt(document.getElementById('sell-qty').value) - 1); updateSellTotal(); });
document.getElementById('sell-qty-plus').addEventListener('click', () => { document.getElementById('sell-qty').value = parseInt(document.getElementById('sell-qty').value) + 1; updateSellTotal(); });
document.getElementById('sell-qty').addEventListener('input', updateSellTotal);
document.getElementById('btn-confirm-sell').addEventListener('click', executeSell);
document.getElementById('btn-cancel-sell').addEventListener('click', () => { document.getElementById('modal-sell').style.display = 'none'; });

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

document.getElementById('btn-bot-toggle').addEventListener('click', async () => {
  if (state.botRunning) {
    await api.stopBot(); updateBotButton(false);
  } else {
    await api.startBot(); updateBotButton(true);
  }
  setTimeout(syncState, 2000);
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
});

// 초기화 + 30초마다 자동 동기화
syncState();
setInterval(syncState, 30000);
