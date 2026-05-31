const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 종목 이름 → Yahoo 코드
const STOCK_MAP = {
  // KOSPI 대형주
  '삼성전자': '005930.KS', 'SK하이닉스': '000660.KS', 'LG에너지솔루션': '373220.KS',
  '삼성바이오로직스': '207940.KS', '현대차': '005380.KS', '현대자동차': '005380.KS',
  '기아': '000270.KS', 'POSCO홀딩스': '005490.KS', '삼성물산': '028260.KS',
  'SK이노베이션': '096770.KS', '두산에너빌리티': '034020.KS', 'HD현대': '267250.KS',
  '한국전력': '015760.KS', 'KT&G': '033780.KS', '한화에어로스페이스': '012450.KS',
  '현대모비스': '012330.KS', 'LG화학': '051910.KS', '삼성SDI': '006400.KS',
  'LG전자': '066570.KS', '씨에스윈드': '100790.KS',
  // KOSPI 금융
  'KB금융': '105560.KS', '신한지주': '055550.KS', '하나금융지주': '086790.KS',
  '우리금융지주': '316140.KS', '메리츠금융지주': '138040.KS', '삼성화재': '000810.KS',
  // KOSPI IT·통신·플랫폼
  'NAVER': '035420.KS', '네이버': '035420.KS', '카카오': '035720.KS',
  '카카오뱅크': '323410.KS', '크래프톤': '259960.KS', '하이브': '352820.KS',
  'SK텔레콤': '017670.KS', 'KT': '030200.KS',
  // KOSPI 헬스케어
  '셀트리온': '068270.KS',
  // KOSDAQ
  '에코프로비엠': '247540.KQ', '에코프로': '086520.KQ', 'HLB': '028300.KQ',
  '펄어비스': '263750.KQ', '카카오게임즈': '293490.KQ', '위메이드': '112040.KQ',
  '클래시스': '214150.KQ', '리노공업': '058470.KQ', '파마리서치': '214450.KQ',
  '알테오젠': '196170.KQ', '솔브레인': '357780.KQ',
};

// 6자리 코드 → Yahoo 코드 역방향 맵
const CODE_TO_YAHOO = {};
for (const yahoo of Object.values(STOCK_MAP)) {
  const code = yahoo.split('.')[0];
  if (!CODE_TO_YAHOO[code]) CODE_TO_YAHOO[code] = yahoo;
}

const BOT_WATCHLIST = [
  '005930', '000660', '373220', '005380', '000270',
  '035420', '035720', '066570', '051910', '006400',
  '068270', '100790', '247540', '086520', '028300',
];

const DEFAULT_BOT_CONFIG = {
  profitTarget: 0.03,
  stopLoss: 0.05,
  buyPerStock: 0.15,
  intervalMin: 30,
};

const DEFAULT_STATE = {
  cash: 1000000,
  initialCash: 1000000,
  portfolio: {},
  history: [],
  botLog: [],
  botRunning: false,
  botConfig: { ...DEFAULT_BOT_CONFIG },
  valueHistory: [],
  watchlist: [],
};

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!saved.botConfig) saved.botConfig = { ...DEFAULT_BOT_CONFIG };
      if (!saved.valueHistory) saved.valueHistory = [];
      if (!saved.watchlist) saved.watchlist = [];
      return saved;
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

function getTotalValue() {
  let stockVal = 0;
  Object.values(state.portfolio).forEach(p => { stockVal += p.qty * (p.lastPrice || p.avgPrice); });
  return state.cash + stockVal;
}

function recordValueSnapshot() {
  const now = new Date();
  const label = now.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    + ' ' + now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.valueHistory.push({ date: label, value: Math.round(getTotalValue()) });
  if (state.valueHistory.length > 300) state.valueHistory.shift();
}

async function fetchYahoo(yahooCode, range = '1mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=${range}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getStockData(code, range = '1mo') {
  const yahooCode = code.includes('.') ? code : (CODE_TO_YAHOO[code] || STOCK_MAP[code] || code + '.KS');
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

function analyzeStock(prices, currentPrice) {
  if (prices.length < 5) return { signal: 'hold', reasons: ['데이터 부족'] };
  const all = prices.map(p => p.price);
  const ma5 = all.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = all.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, all.length);
  const change30d = ((currentPrice - all[0]) / all[0]) * 100;

  let score = 0; const reasons = [];
  if (currentPrice > ma5) { score++; reasons.push(`현재가가 5일 평균(${Math.round(ma5).toLocaleString()}) 위`); }
  else { score--; reasons.push('현재가가 5일 평균 아래'); }
  if (ma5 > ma20) { score++; reasons.push('골든크로스 — 단기 평균이 중기 평균 위'); }
  else { score--; reasons.push('데드크로스 — 단기 평균이 중기 평균 아래'); }
  if (change30d > 5) { score++; reasons.push(`한 달 +${change30d.toFixed(1)}% 상승`); }
  else if (change30d < -5) { score--; reasons.push(`한 달 ${change30d.toFixed(1)}% 하락`); }

  return { signal: score >= 2 ? 'buy' : score <= -2 ? 'sell' : 'hold', reasons, change30d };
}

function addLog(emoji, msg, type = 'info') {
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  state.botLog.unshift({ time, msg: emoji + ' ' + msg, type });
  if (state.botLog.length > 100) state.botLog.pop();
  saveState(state);
  console.log(`[BOT] ${time} ${msg}`);
}

async function botCycle() {
  const cfg = state.botConfig;
  addLog('🤖', '분석 시작...', 'info');

  for (const [code, pos] of Object.entries(state.portfolio)) {
    try {
      const data = await getStockData(code);
      const cur = data.currentPrice;
      pos.lastPrice = cur;
      const ret = (cur - pos.avgPrice) / pos.avgPrice;

      if (ret >= cfg.profitTarget) {
        const profit = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, avgPrice: pos.avgPrice, profit, date: new Date().toLocaleDateString('ko-KR') });
        addLog('📈', `${pos.name} ${pos.qty}주 매도 +${(ret*100).toFixed(1)}% (+${profit.toLocaleString()}원)`, 'sell');
        delete state.portfolio[code];
        recordValueSnapshot();
      } else if (ret <= -cfg.stopLoss) {
        const profit = Math.round((cur - pos.avgPrice) * pos.qty);
        state.cash += cur * pos.qty;
        state.history.push({ type: 'sell', name: pos.name, qty: pos.qty, price: cur, avgPrice: pos.avgPrice, profit, date: new Date().toLocaleDateString('ko-KR') });
        addLog('🛑', `${pos.name} 손절 ${(ret*100).toFixed(1)}% (${profit.toLocaleString()}원)`, 'loss');
        delete state.portfolio[code];
        recordValueSnapshot();
      } else {
        addLog('👀', `${pos.name} 보유 중 ${ret >= 0 ? '+' : ''}${(ret*100).toFixed(1)}% — 대기`, 'info');
      }
    } catch (e) {
      addLog('⚠️', `${pos.name} 가격 조회 실패`, 'warn');
    }
  }

  const held = Object.keys(state.portfolio);
  for (const code of BOT_WATCHLIST.filter(c => !held.includes(c))) {
    if (state.cash < 50000) break;
    try {
      const data = await getStockData(code);
      const analysis = analyzeStock(data.prices, data.currentPrice);
      if (analysis.signal !== 'buy') continue;

      const qty = Math.max(1, Math.floor(state.cash * cfg.buyPerStock / data.currentPrice));
      const total = qty * data.currentPrice;
      if (total > state.cash) continue;

      state.cash -= total;
      state.portfolio[code] = { name: data.name, qty, avgPrice: data.currentPrice, lastPrice: data.currentPrice };
      state.history.push({ type: 'buy', name: data.name, qty, price: data.currentPrice, date: new Date().toLocaleDateString('ko-KR') });
      addLog('✅', `${data.name} ${qty}주 매수 @ ${data.currentPrice.toLocaleString()}원`, 'buy');
      recordValueSnapshot();
      break;
    } catch (e) { /* skip */ }
  }

  addLog('✔', `사이클 완료 — 다음 실행 ${cfg.intervalMin}분 후`, 'info');
  saveState(state);
}

function startBot() {
  if (botTimer) clearInterval(botTimer);
  state.botRunning = true;
  const ms = (state.botConfig.intervalMin || 30) * 60 * 1000;
  addLog('🚀', `자동매매 봇 시작! ${state.botConfig.intervalMin}분마다 종목 점검`, 'info');
  botCycle();
  botTimer = setInterval(botCycle, ms);
  saveState(state);
}

function stopBot() {
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  state.botRunning = false;
  addLog('⏹', '봇 정지됨', 'info');
  saveState(state);
}

// ── API 라우트
app.get('/api/state', (req, res) => res.json({ ...state, botRunning: !!botTimer }));

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
    const data = await getStockData(req.params.code, req.query.range || '1mo');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bot/start', (req, res) => { startBot(); res.json({ ok: true }); });
app.post('/api/bot/stop', (req, res) => { stopBot(); res.json({ ok: true }); });
app.get('/api/bot/log', (req, res) => res.json({ log: state.botLog, running: !!botTimer }));

app.post('/api/bot/config', (req, res) => {
  const { profitTarget, stopLoss, buyPerStock, intervalMin } = req.body;
  if (profitTarget !== undefined) state.botConfig.profitTarget = profitTarget;
  if (stopLoss !== undefined) state.botConfig.stopLoss = stopLoss;
  if (buyPerStock !== undefined) state.botConfig.buyPerStock = buyPerStock;
  if (intervalMin !== undefined) state.botConfig.intervalMin = intervalMin;
  if (botTimer) {
    clearInterval(botTimer);
    botTimer = setInterval(botCycle, state.botConfig.intervalMin * 60 * 1000);
  }
  saveState(state);
  res.json({ ok: true, config: state.botConfig });
});

app.get('/api/watchlist', (req, res) => res.json({ watchlist: state.watchlist }));
app.post('/api/watchlist', (req, res) => {
  if (req.body.watchlist !== undefined) state.watchlist = req.body.watchlist;
  saveState(state);
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  const sells = state.history.filter(h => h.type === 'sell');
  const sellsWithProfit = sells.filter(h => h.profit !== undefined);
  const winTrades = sellsWithProfit.filter(h => h.profit > 0).length;
  const totalProfit = sellsWithProfit.reduce((s, h) => s + h.profit, 0);

  let maxDrawdown = 0;
  if (state.valueHistory.length > 1) {
    let peak = state.valueHistory[0].value;
    for (const { value } of state.valueHistory) {
      if (value > peak) peak = value;
      const dd = peak > 0 ? (value - peak) / peak : 0;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }

  res.json({
    totalTrades: sells.length,
    winTrades,
    winRate: sellsWithProfit.length > 0 ? (winTrades / sellsWithProfit.length) * 100 : null,
    totalProfit,
    maxDrawdown: maxDrawdown * 100,
    valueHistory: state.valueHistory,
  });
});

app.post('/api/snapshot', (req, res) => {
  recordValueSnapshot();
  saveState(state);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
  // 서버 부팅 시 항상 봇 자동 시작 (Railway 재시작 대응)
  startBot();
});
