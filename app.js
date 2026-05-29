// 한국 주식 코드 매핑 (종목명 → 야후파이낸스 코드)
const STOCK_MAP = {
  '삼성전자': '005930.KS', '삼성전자우': '005935.KS',
  '현대차': '005380.KS', '현대자동차': '005380.KS',
  '기아': '000270.KS', '기아차': '000270.KS',
  'naver': '035420.KS', 'NAVER': '035420.KS', '네이버': '035420.KS',
  'LG화학': '051910.KS', '삼성SDI': '006400.KS',
  'SK하이닉스': '000660.KS', '카카오': '035720.KS',
  'LG전자': '066570.KS', '현대모비스': '012330.KS',
  'POSCO홀딩스': '005490.KS', 'KB금융': '105560.KS',
  '신한지주': '055550.KS', '하나금융지주': '086790.KS',
  'SK이노베이션': '096770.KS', '삼성바이오로직스': '207940.KS',
  '셀트리온': '068270.KS', '카카오뱅크': '323410.KS',
  '크래프톤': '259960.KS', '하이브': '352820.KS',
  '씨에스윈드': '100790.KS', 'CS Wind': '100790.KS', '100790': '100790.KS',
};

const CODE_TO_NAME = {};
Object.entries(STOCK_MAP).forEach(([name, code]) => {
  const shortCode = code.replace('.KS', '').replace('.KQ', '');
  CODE_TO_NAME[shortCode] = name;
});

// CORS 프록시 목록 (순서대로 시도)
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// 모의 데이터 (API 실패 시 fallback)
function generateMockPrices(basePrice, days) {
  const prices = [];
  let price = basePrice * (0.85 + Math.random() * 0.1);
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    price = price * (1 + (Math.random() - 0.48) * 0.03);
    const d = new Date(now - i * 86400000);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      prices.push({
        date: d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
        price: Math.round(price),
      });
    }
  }
  return prices;
}

const MOCK_DATA = {
  '005930': { name: '삼성전자', price: 74000 },
  '005380': { name: '현대차', price: 235000 },
  '000270': { name: '기아', price: 98000 },
  '035420': { name: 'NAVER', price: 195000 },
  '051910': { name: 'LG화학', price: 310000 },
  '006400': { name: '삼성SDI', price: 280000 },
  '000660': { name: 'SK하이닉스', price: 195000 },
  '035720': { name: '카카오', price: 48000 },
  '100790': { name: '씨에스윈드', price: 62000 },
};

// 봇 감시 종목 (자동 매수 후보)
const BOT_WATCHLIST = [
  '005930', '000660', '005380', '000270', '035420',
  '100790', '035720', '066570', '051910', '006400',
];

// 봇 설정
const BOT_CONFIG = {
  profitTarget: 0.03,    // 3% 수익 시 매도
  stopLoss: -0.05,       // -5% 손실 시 손절
  buyPerStock: 0.15,     // 현금의 15%씩 매수
  intervalMs: 30 * 60 * 1000, // 30분
};

// 상태 관리
let state = {
  cash: 1000000,
  initialCash: 1000000,
  portfolio: {},
  history: [],
  botLog: [],
  botRunning: false,
  botTimer: null,
  currentStock: null,
  currentPrice: 0,
  chartInstance: null,
  chartPrices: [],
};

// localStorage 저장/불러오기
function saveState() {
  localStorage.setItem('stock-sim', JSON.stringify({
    cash: state.cash,
    initialCash: state.initialCash,
    portfolio: state.portfolio,
    history: state.history,
    botLog: state.botLog.slice(-50),
  }));
}

function loadState() {
  const saved = localStorage.getItem('stock-sim');
  if (saved) {
    const data = JSON.parse(saved);
    state.cash = data.cash;
    state.initialCash = data.initialCash;
    state.portfolio = data.portfolio;
    state.history = data.history;
    state.botLog = data.botLog || [];
  }
}

// ── 봇 로그 추가
function addBotLog(emoji, msg, type = 'info') {
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.botLog.unshift({ time, msg: emoji + ' ' + msg, type });
  if (state.botLog.length > 50) state.botLog.pop();
  renderBotLog();
}

// ── 봇: 보유 주식 점검 (수익/손절)
async function botCheckPortfolio() {
  const entries = Object.entries(state.portfolio);
  for (const [code, pos] of entries) {
    try {
      const data = await fetchStockData(code + '.KS', 30);
      const cur = data.currentPrice;
      pos.lastPrice = cur;
      const ret = (cur - pos.avgPrice) / pos.avgPrice;

      if (ret >= BOT_CONFIG.profitTarget) {
        const earned = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, date: new Date().toLocaleDateString('ko-KR') });
        addBotLog('📈', `${pos.name} ${pos.qty}주 매도 +${(ret * 100).toFixed(1)}% (${earned.toLocaleString()}원 수익)`, 'sell');
        delete state.portfolio[code];
      } else if (ret <= BOT_CONFIG.stopLoss) {
        const loss = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, date: new Date().toLocaleDateString('ko-KR') });
        addBotLog('🛑', `${pos.name} 손절 ${(ret * 100).toFixed(1)}% (${loss.toLocaleString()}원 손실)`, 'loss');
        delete state.portfolio[code];
      } else {
        addBotLog('👀', `${pos.name} 보유 중 ${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}% — 대기`, 'info');
      }
    } catch (e) {
      addBotLog('⚠️', `${pos.name} 가격 조회 실패`, 'warn');
    }
  }
}

// ── 봇: 신규 종목 탐색 & 매수
async function botScanAndBuy() {
  const held = Object.keys(state.portfolio);
  const candidates = BOT_WATCHLIST.filter(c => !held.includes(c));

  for (const code of candidates) {
    if (state.cash < 50000) break;
    try {
      const data = await fetchStockData(code + '.KS', 30);
      const analysis = analyzeStock(data.prices, data.currentPrice);
      if (analysis.signal !== 'buy') continue;

      const budget = state.cash * BOT_CONFIG.buyPerStock;
      const qty = Math.max(1, Math.floor(budget / data.currentPrice));
      const total = qty * data.currentPrice;
      if (total > state.cash) continue;

      state.cash -= total;
      state.portfolio[code] = {
        name: data.name,
        qty,
        avgPrice: data.currentPrice,
        lastPrice: data.currentPrice,
      };
      state.history.push({ type: 'buy', name: data.name, qty, price: data.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
      addBotLog('✅', `${data.name} ${qty}주 매수 @ ${data.currentPrice.toLocaleString()}원`, 'buy');
      break; // 한 번에 1종목만 매수
    } catch (e) {
      // 조회 실패 종목 skip
    }
  }
}

// ── 봇 1회 실행 사이클
async function botCycle() {
  addBotLog('🤖', '분석 시작...', 'info');
  await botCheckPortfolio();
  await botScanAndBuy();
  saveState();
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  addBotLog('✔', `사이클 완료 — 다음 실행: 30분 후`, 'info');
}

// ── 봇 시작/정지
function startBot() {
  if (state.botRunning) return;
  state.botRunning = true;
  addBotLog('🚀', '자동매매 봇 시작! 30분마다 종목 점검', 'info');
  botCycle();
  state.botTimer = setInterval(botCycle, BOT_CONFIG.intervalMs);
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

// ── 봇 로그 렌더링
function renderBotLog() {
  const container = document.getElementById('bot-log');
  if (!container) return;
  if (state.botLog.length === 0) {
    container.innerHTML = '<p class="empty-msg">봇 활동 내역이 없습니다.</p>';
    return;
  }
  container.innerHTML = state.botLog.map(l => `
    <div class="bot-log-item ${l.type}">
      <span class="log-time">${l.time}</span>
      <span class="log-msg">${l.msg}</span>
    </div>
  `).join('');
}

// 숫자 포맷
function fmt(n) {
  return Math.round(n).toLocaleString('ko-KR') + ' 원';
}

// 주가 조회 (프록시 순차 시도 → 실패 시 모의 데이터)
async function fetchWithProxy(targetUrl) {
  for (const makeProxy of PROXIES) {
    try {
      const res = await Promise.race([
        fetch(makeProxy(targetUrl)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      if (!res.ok) continue;
      const text = await res.text();
      const json = JSON.parse(text);
      if (json?.chart?.result?.[0]) return json;
    } catch (e) {
      console.warn('프록시 실패:', makeProxy(targetUrl).slice(0, 60), e.message);
    }
  }
  return null;
}

async function fetchStockData(code, period = 30) {
  const yahooCode = code.includes('.') ? code : (STOCK_MAP[code] || code + '.KS');
  const range = period <= 30 ? '1mo' : period <= 90 ? '3mo' : '6mo';
  const targetUrl = `${YF_BASE}${yahooCode}?interval=1d&range=${range}`;

  const json = await fetchWithProxy(targetUrl);
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

    return {
      name: meta.shortName || meta.symbol,
      code: meta.symbol,
      currentPrice: meta.regularMarketPrice,
      prevClose: meta.previousClose || meta.chartPreviousClose,
      prices,
      isMock: false,
    };
  }

  // API 전부 실패 → 모의 데이터로 fallback
  console.warn('API 실패 — 모의 데이터 사용');
  const mock = MOCK_DATA[shortCode] || { name: shortCode, price: 50000 };
  const prices = generateMockPrices(mock.price, period);
  const currentPrice = prices[prices.length - 1].price;
  return {
    name: mock.name,
    code: yahooCode,
    currentPrice,
    prevClose: prices[prices.length - 2]?.price || currentPrice,
    prices,
    isMock: true,
  };
}

// 코드 해석 (한글명 → 야후코드)
function resolveCode(input) {
  const trimmed = input.trim();
  if (STOCK_MAP[trimmed]) return STOCK_MAP[trimmed];
  const upper = trimmed.toUpperCase();
  if (STOCK_MAP[upper]) return STOCK_MAP[upper];
  // 숫자 코드 입력
  if (/^\d{6}$/.test(trimmed)) return trimmed + '.KS';
  return null;
}

// AI 분석 (이동평균 + 모멘텀 기반)
function analyzeStock(prices, currentPrice) {
  if (prices.length < 5) return { signal: 'hold', reason: '데이터 부족으로 분석 불가' };

  const recent = prices.slice(-5).map(p => p.price);
  const all = prices.map(p => p.price);

  const ma5 = recent.reduce((a, b) => a + b, 0) / recent.length;
  const ma20 = all.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, all.length);
  const ma60 = all.reduce((a, b) => a + b, 0) / all.length;

  const change1d = ((currentPrice - prices[prices.length - 2]?.price) / prices[prices.length - 2]?.price * 100) || 0;
  const change30d = ((currentPrice - prices[0].price) / prices[0].price) * 100;

  let signal = 'hold';
  let reasons = [];
  let score = 0;

  if (currentPrice > ma5) { score++; reasons.push(`현재가(${currentPrice.toLocaleString()})가 5일 평균(${Math.round(ma5).toLocaleString()}) 위`); }
  else { score--; reasons.push(`현재가가 5일 평균 아래`); }

  if (ma5 > ma20) { score++; reasons.push('단기 이동평균이 중기 이동평균 돌파 (골든크로스)'); }
  else { score--; reasons.push('단기 이동평균이 중기 이동평균 아래 (데드크로스)'); }

  if (change30d > 5) { score++; reasons.push(`한 달간 +${change30d.toFixed(1)}% 상승 추세`); }
  else if (change30d < -5) { score--; reasons.push(`한 달간 ${change30d.toFixed(1)}% 하락 추세`); }

  if (score >= 2) signal = 'buy';
  else if (score <= -2) signal = 'sell';

  return { signal, reasons, change1d, change30d, ma5, ma20 };
}

// 잔고 UI 업데이트
function updateBalanceUI() {
  let stockValue = 0;
  Object.entries(state.portfolio).forEach(([code, pos]) => {
    stockValue += pos.qty * (pos.lastPrice || pos.avgPrice);
  });

  const total = state.cash + stockValue;
  const ret = ((total - state.initialCash) / state.initialCash) * 100;

  document.getElementById('cash').textContent = fmt(state.cash);
  document.getElementById('stock-value').textContent = fmt(stockValue);
  document.getElementById('total-asset').textContent = fmt(total);
  const retEl = document.getElementById('total-return');
  retEl.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
  retEl.className = 'value ' + (ret >= 0 ? 'positive' : 'negative');
}

// 보유 주식 UI
function renderPortfolio() {
  const container = document.getElementById('portfolio-list');
  const entries = Object.entries(state.portfolio);
  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-msg">보유 주식이 없습니다.</p>';
    return;
  }
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
      </div>
    `;
  }).join('');
}

// 거래 내역 UI
function renderHistory() {
  const container = document.getElementById('history-list');
  if (state.history.length === 0) {
    container.innerHTML = '<p class="empty-msg">거래 내역이 없습니다.</p>';
    return;
  }
  container.innerHTML = [...state.history].reverse().slice(0, 20).map(h => `
    <div class="history-item">
      <span class="type-badge ${h.type}">${h.type === 'buy' ? '매수' : '매도'}</span>
      <span class="h-name">${h.name}</span>
      <span class="h-detail">${h.qty}주 · ${h.price.toLocaleString()}원 · ${h.date}</span>
    </div>
  `).join('');
}

// 차트 렌더링
function renderChart(prices) {
  const ctx = document.getElementById('price-chart').getContext('2d');
  if (state.chartInstance) state.chartInstance.destroy();

  const labels = prices.map(p => p.date);
  const data = prices.map(p => p.price);
  const minPrice = Math.min(...data) * 0.995;
  const maxPrice = Math.max(...data) * 1.005;

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: {
          label: ctx => ctx.parsed.y.toLocaleString() + '원'
        }
      }},
      scales: {
        x: { ticks: { color: '#6b7280', maxTicksLimit: 6 }, grid: { color: '#1e2130' } },
        y: { ticks: { color: '#6b7280', callback: v => v.toLocaleString() }, grid: { color: '#1e2130' }, min: minPrice, max: maxPrice },
      },
    },
  });
}

// AI 분석 표시
function showAnalysis(analysis, stockName) {
  const signalText = { buy: '📈 매수 추천', sell: '📉 매도 추천', hold: '⏸ 관망 추천' };
  const signalClass = { buy: 'buy', sell: 'sell', hold: 'hold' };

  const content = document.getElementById('ai-content');
  content.innerHTML = `
    <p class="signal ${signalClass[analysis.signal]}">${signalText[analysis.signal]}</p>
    <p><strong>분석 근거:</strong></p>
    <ul style="margin: 8px 0 12px 16px; color: #9ca3af;">
      ${analysis.reasons.map(r => `<li>${r}</li>`).join('')}
    </ul>
    <p>전일 대비: <strong style="color:${analysis.change1d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change1d >= 0 ? '+' : ''}${analysis.change1d.toFixed(2)}%</strong>
    &nbsp;| 1개월: <strong style="color:${analysis.change30d >= 0 ? '#ef4444' : '#3b82f6'}">${analysis.change30d >= 0 ? '+' : ''}${analysis.change30d.toFixed(2)}%</strong></p>
    <p style="margin-top:10px; font-size:0.75rem; color:#4b5563;">※ AI 분석은 참고용입니다. 투자 결정은 본인 판단으로 하세요.</p>
  `;

  const actions = document.getElementById('ai-actions');
  actions.style.display = 'flex';

  const buyBtn = document.getElementById('btn-buy');
  if (analysis.signal === 'sell' && state.portfolio[state.currentStock?.code]) {
    buyBtn.textContent = '📉 매도하기';
    buyBtn.onclick = () => openSellModal(state.currentStock.code);
  } else {
    buyBtn.textContent = '✅ 매수하기';
    buyBtn.onclick = () => openBuyModal();
  }
}

// 종목 검색/로드
async function loadStock(input) {
  const detail = document.getElementById('stock-detail');
  detail.style.display = 'block';
  document.getElementById('stock-name').textContent = '로딩 중...';
  document.getElementById('current-price').textContent = '-';
  document.getElementById('price-change').textContent = '';
  document.getElementById('ai-content').innerHTML = '<p class="loading">데이터 조회 중... (최대 25초 소요)</p>';
  document.getElementById('ai-actions').style.display = 'none';

  const code = resolveCode(input);
  if (!code) {
    document.getElementById('ai-content').innerHTML = '<p class="loading">종목을 찾을 수 없습니다. 정확한 종목명 또는 6자리 코드를 입력해주세요.</p>';
    return;
  }

  try {
    const data = await fetchStockData(code, 30);
    state.currentStock = { ...data, yahooCode: code };
    state.currentPrice = data.currentPrice;
    state.chartPrices = data.prices;

    // 보유중이면 lastPrice 업데이트
    const shortCode = code.replace('.KS', '').replace('.KQ', '');
    if (state.portfolio[shortCode]) {
      state.portfolio[shortCode].lastPrice = data.currentPrice;
      saveState();
      updateBalanceUI();
      renderPortfolio();
    }

    const change = data.currentPrice - data.prevClose;
    const changePct = (change / data.prevClose) * 100;

    document.getElementById('stock-name').textContent = data.name + (data.isMock ? ' ⚠️ 모의데이터' : '');
    document.getElementById('stock-code').textContent = shortCode;
    document.getElementById('current-price').textContent = data.currentPrice.toLocaleString() + ' 원';
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${Math.round(change).toLocaleString()}원 (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');

    renderChart(data.prices);

    const analysis = analyzeStock(data.prices, data.currentPrice);
    showAnalysis(analysis, data.name);

  } catch (e) {
    document.getElementById('ai-content').innerHTML = '<p class="loading">데이터 조회 실패. 잠시 후 다시 시도해주세요.</p>';
    console.error(e);
  }
}

// 매수 모달
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
  const total = qty * state.currentPrice;
  document.getElementById('buy-total').textContent = fmt(total);
  document.getElementById('buy-avail').textContent = fmt(state.cash);
}

// 매도 모달
function openSellModal(code) {
  const pos = state.portfolio[code];
  if (!pos) return;
  state.currentStock = { code, name: pos.name };
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
  const total = qty * state.currentPrice;
  document.getElementById('sell-total').textContent = fmt(total);
}

// 매수 실행
function executeBuy() {
  const qty = parseInt(document.getElementById('buy-qty').value);
  const total = qty * state.currentPrice;

  if (qty <= 0) { alert('수량을 1주 이상 입력하세요.'); return; }
  if (total > state.cash) { alert('현금이 부족합니다.'); return; }

  const code = state.currentStock.yahooCode?.replace('.KS', '').replace('.KQ', '') || state.currentStock.code;
  state.cash -= total;

  if (state.portfolio[code]) {
    const pos = state.portfolio[code];
    const newQty = pos.qty + qty;
    pos.avgPrice = (pos.avgPrice * pos.qty + state.currentPrice * qty) / newQty;
    pos.qty = newQty;
    pos.lastPrice = state.currentPrice;
  } else {
    state.portfolio[code] = {
      name: state.currentStock.name,
      qty,
      avgPrice: state.currentPrice,
      lastPrice: state.currentPrice,
    };
  }

  state.history.push({
    type: 'buy', name: state.currentStock.name, qty,
    price: state.currentPrice,
    date: new Date().toLocaleDateString('ko-KR'),
  });

  saveState();
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  document.getElementById('modal-buy').style.display = 'none';
}

// 매도 실행
function executeSell() {
  const code = state.currentStock.code;
  const pos = state.portfolio[code];
  if (!pos) return;

  const qty = parseInt(document.getElementById('sell-qty').value);
  if (qty <= 0) { alert('수량을 1주 이상 입력하세요.'); return; }
  if (qty > pos.qty) { alert('보유 수량을 초과합니다.'); return; }

  const total = qty * state.currentPrice;
  state.cash += total;

  pos.qty -= qty;
  if (pos.qty === 0) delete state.portfolio[code];

  state.history.push({
    type: 'sell', name: pos.name, qty,
    price: state.currentPrice,
    date: new Date().toLocaleDateString('ko-KR'),
  });

  saveState();
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  document.getElementById('modal-sell').style.display = 'none';
}

// 이벤트 바인딩
document.getElementById('btn-search').addEventListener('click', () => {
  loadStock(document.getElementById('search-input').value);
});
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadStock(e.target.value);
});

document.querySelectorAll('.btn-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.name;
    document.getElementById('search-input').value = name;
    loadStock(name);
  });
});

document.querySelectorAll('.chart-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (state.currentStock) {
      const data = await fetchStockData(state.currentStock.yahooCode || state.currentStock.code, parseInt(tab.dataset.period));
      renderChart(data.prices);
    }
  });
});

document.getElementById('btn-buy').addEventListener('click', openBuyModal);
document.getElementById('btn-skip').addEventListener('click', () => {
  document.getElementById('ai-actions').style.display = 'none';
});

// 매수 모달
document.getElementById('qty-minus').addEventListener('click', () => {
  const el = document.getElementById('buy-qty');
  el.value = Math.max(1, parseInt(el.value) - 1);
  updateBuyTotal();
});
document.getElementById('qty-plus').addEventListener('click', () => {
  document.getElementById('buy-qty').value = parseInt(document.getElementById('buy-qty').value) + 1;
  updateBuyTotal();
});
document.getElementById('buy-qty').addEventListener('input', updateBuyTotal);
document.getElementById('btn-confirm-buy').addEventListener('click', executeBuy);
document.getElementById('btn-cancel-buy').addEventListener('click', () => {
  document.getElementById('modal-buy').style.display = 'none';
});

// 매도 모달
document.getElementById('sell-qty-minus').addEventListener('click', () => {
  const el = document.getElementById('sell-qty');
  el.value = Math.max(1, parseInt(el.value) - 1);
  updateSellTotal();
});
document.getElementById('sell-qty-plus').addEventListener('click', () => {
  document.getElementById('sell-qty').value = parseInt(document.getElementById('sell-qty').value) + 1;
  updateSellTotal();
});
document.getElementById('sell-qty').addEventListener('input', updateSellTotal);
document.getElementById('btn-confirm-sell').addEventListener('click', executeSell);
document.getElementById('btn-cancel-sell').addEventListener('click', () => {
  document.getElementById('modal-sell').style.display = 'none';
});

// 자금 설정 모달
document.getElementById('btn-charge').addEventListener('click', () => {
  document.getElementById('modal-charge').style.display = 'flex';
});
document.getElementById('btn-confirm-charge').addEventListener('click', () => {
  const amount = parseInt(document.getElementById('charge-amount').value);
  if (amount < 100000) { alert('최소 10만원 이상 설정해주세요.'); return; }
  if (!confirm(`자금을 ${amount.toLocaleString()}원으로 초기화합니다. 기존 데이터가 삭제됩니다. 계속할까요?`)) return;
  state.cash = amount;
  state.initialCash = amount;
  state.portfolio = {};
  state.history = [];
  saveState();
  updateBalanceUI();
  renderPortfolio();
  renderHistory();
  document.getElementById('modal-charge').style.display = 'none';
});
document.getElementById('btn-cancel-charge').addEventListener('click', () => {
  document.getElementById('modal-charge').style.display = 'none';
});

// 모달 외부 클릭 닫기
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// 봇 버튼
document.getElementById('btn-bot-toggle').addEventListener('click', () => {
  if (state.botRunning) stopBot(); else startBot();
});

// 초기화
loadState();
updateBalanceUI();
renderPortfolio();
renderHistory();
renderBotLog();
