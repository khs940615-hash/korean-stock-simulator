const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 종목 맵
const STOCK_MAP = {
  '삼성전자': '005930.KS', '현대차': '005380.KS', '현대자동차': '005380.KS',
  '기아': '000270.KS', 'NAVER': '035420.KS', '네이버': '035420.KS',
  'LG화학': '051910.KS', '삼성SDI': '006400.KS', 'SK하이닉스': '000660.KS',
  '카카오': '035720.KS', 'LG전자': '066570.KS', '현대모비스': '012330.KS',
  'POSCO홀딩스': '005490.KS', 'KB금융': '105560.KS', '신한지주': '055550.KS',
  '하나금융지주': '086790.KS', '삼성바이오로직스': '207940.KS',
  '셀트리온': '068270.KS', '카카오뱅크': '323410.KS', '씨에스윈드': '100790.KS',
  '크래프톤': '259960.KS', '하이브': '352820.KS',
};

const BOT_WATCHLIST = [
  '100790', '005930', '000660', '005380', '000270',
  '035420', '035720', '066570', '051910', '006400',
];

const BOT_CONFIG = {
  profitTarget: 0.03,
  stopLoss: -0.05,
  buyPerStock: 0.15,
  intervalMs: 30 * 60 * 1000,
};

// ── 상태 초기값
const DEFAULT_STATE = {
  cash: 1000000,
  initialCash: 1000000,
  portfolio: {},
  history: [],
  botLog: [],
  botRunning: false,
};

// ── 상태 저장/불러오기
function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) { console.error('상태 로드 실패:', e.message); }
  return { ...DEFAULT_STATE };
}

function saveState(st) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(st, null, 2));
  } catch (e) { console.error('상태 저장 실패:', e.message); }
}

let state = loadState();
state.botRunning = false;
let botTimer = null;

// ── Yahoo Finance 직접 호출 (서버는 CORS 없음)
async function fetchYahoo(yahooCode, range = '1mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getStockData(code, range = '1mo') {
  const yahooCode = code.includes('.') ? code : (STOCK_MAP[code] || code + '.KS');
  const json = await fetchYahoo(yahooCode, range);
  const result = json.chart.result[0];
  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const prices = timestamps.map((t, i) => ({
    date: new Date(t * 1000).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
    price: closes[i],
  })).filter(p => p.price != null);

  return {
    name: meta.shortName || meta.symbol,
    code: yahooCode,
    currentPrice: meta.regularMarketPrice,
    prevClose: meta.previousClose || meta.chartPreviousClose,
    prices,
  };
}

// ── AI 분석 (이동평균)
function analyzeStock(prices, currentPrice) {
  if (prices.length < 5) return { signal: 'hold', reasons: ['데이터 부족'] };
  const all = prices.map(p => p.price);
  const ma5 = all.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = all.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, all.length);
  const change30d = ((currentPrice - all[0]) / all[0]) * 100;

  let score = 0;
  const reasons = [];

  if (currentPrice > ma5) { score++; reasons.push(`현재가가 5일 평균(${Math.round(ma5).toLocaleString()}) 위`); }
  else { score--; reasons.push('현재가가 5일 평균 아래'); }

  if (ma5 > ma20) { score++; reasons.push('골든크로스 — 단기 평균이 중기 평균 위'); }
  else { score--; reasons.push('데드크로스 — 단기 평균이 중기 평균 아래'); }

  if (change30d > 5) { score++; reasons.push(`한 달 +${change30d.toFixed(1)}% 상승`); }
  else if (change30d < -5) { score--; reasons.push(`한 달 ${change30d.toFixed(1)}% 하락`); }

  const signal = score >= 2 ? 'buy' : score <= -2 ? 'sell' : 'hold';
  return { signal, reasons, change30d };
}

function addLog(emoji, msg, type = 'info') {
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.botLog.unshift({ time, msg: emoji + ' ' + msg, type });
  if (state.botLog.length > 100) state.botLog.pop();
  saveState(state);
  console.log(`[BOT] ${time} ${msg}`);
}

// ── 봇 사이클
async function botCycle() {
  addLog('🤖', '분석 시작...', 'info');

  // 보유 주식 점검
  for (const [code, pos] of Object.entries(state.portfolio)) {
    try {
      const data = await getStockData(code + '.KS');
      const cur = data.currentPrice;
      pos.lastPrice = cur;
      const ret = (cur - pos.avgPrice) / pos.avgPrice;

      if (ret >= BOT_CONFIG.profitTarget) {
        const earned = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, date: new Date().toLocaleDateString('ko-KR') });
        addLog('📈', `${pos.name} ${pos.qty}주 매도 +${(ret*100).toFixed(1)}% (+${earned.toLocaleString()}원)`, 'sell');
        delete state.portfolio[code];
      } else if (ret <= BOT_CONFIG.stopLoss) {
        const loss = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, date: new Date().toLocaleDateString('ko-KR') });
        addLog('🛑', `${pos.name} 손절 ${(ret*100).toFixed(1)}% (${loss.toLocaleString()}원 손실)`, 'loss');
        delete state.portfolio[code];
      } else {
        addLog('👀', `${pos.name} 보유 중 ${ret >= 0 ? '+' : ''}${(ret*100).toFixed(1)}% — 대기`, 'info');
      }
    } catch (e) {
      addLog('⚠️', `${pos.name} 가격 조회 실패`, 'warn');
    }
  }

  // 신규 종목 탐색
  const held = Object.keys(state.portfolio);
  for (const code of BOT_WATCHLIST.filter(c => !held.includes(c))) {
    if (state.cash < 50000) break;
    try {
      const data = await getStockData(code + '.KS');
      const analysis = analyzeStock(data.prices, data.currentPrice);
      if (analysis.signal !== 'buy') continue;

      const qty = Math.max(1, Math.floor(state.cash * BOT_CONFIG.buyPerStock / data.currentPrice));
      const total = qty * data.currentPrice;
      if (total > state.cash) continue;

      state.cash -= total;
      state.portfolio[code] = { name: data.name, qty, avgPrice: data.currentPrice, lastPrice: data.currentPrice };
      state.history.push({ type: 'buy', name: data.name, qty, price: data.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
      addLog('✅', `${data.name} ${qty}주 매수 @ ${data.currentPrice.toLocaleString()}원`, 'buy');
      break;
    } catch (e) { /* skip */ }
  }

  addLog('✔', `사이클 완료 — 다음 실행 30분 후`, 'info');
  saveState(state);
}

function startBot() {
  if (botTimer) return;
  state.botRunning = true;
  addLog('🚀', '자동매매 봇 시작! 30분마다 종목 점검', 'info');
  botCycle();
  botTimer = setInterval(botCycle, BOT_CONFIG.intervalMs);
  saveState(state);
}

function stopBot() {
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  state.botRunning = false;
  addLog('⏹', '봇 정지됨', 'info');
  saveState(state);
}

// ── API 라우트
app.get('/api/state', (req, res) => {
  res.json({ ...state, botRunning: !!botTimer });
});

app.post('/api/state', (req, res) => {
  const { cash, initialCash, portfolio, history } = req.body;
  if (cash !== undefined) state.cash = cash;
  if (initialCash !== undefined) state.initialCash = initialCash;
  if (portfolio !== undefined) state.portfolio = portfolio;
  if (history !== undefined) state.history = history;
  saveState(state);
  res.json({ ok: true });
});

app.get('/api/stock/:code', async (req, res) => {
  try {
    const range = req.query.range || '1mo';
    const data = await getStockData(req.params.code, range);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/start', (req, res) => {
  startBot();
  res.json({ ok: true, running: true });
});

app.post('/api/bot/stop', (req, res) => {
  stopBot();
  res.json({ ok: true, running: false });
});

app.get('/api/bot/log', (req, res) => {
  res.json({ log: state.botLog, running: !!botTimer });
});

app.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
  // 이전에 봇이 켜져 있었으면 자동 재시작
  if (loadState().botRunning) startBot();
});
