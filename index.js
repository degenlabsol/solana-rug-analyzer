/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');

// --- Config ---
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION || '';

const SOURCE_CHAT_IDS = (process.env.SOURCE_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const FORWARD_CHAT_ID = process.env.FORWARD_CHAT_ID;

const MIN_FORWARD_SCORE = parseInt(process.env.MIN_FORWARD_SCORE || '60', 10);
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '8000', 10);

const STORE_PATH = path.join(__dirname, 'analyzed.json');
const STORE_MAX = 5000;
const REANALYZE_AFTER_MS = 6 * 60 * 60 * 1000;

if (!API_ID || !API_HASH) {
  console.error('[boot] FATAL: TELEGRAM_API_ID oder TELEGRAM_API_HASH fehlt in .env');
  process.exit(1);
}

// --- Speicher Logik ---
let store = { tokens: {} };
function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️ Fehler beim Laden der Datenbank.');
  }
}

function saveStore() {
  try {
    const keys = Object.keys(store.tokens);
    if (keys.length > STORE_MAX) {
      const sorted = keys.sort((a, b) => store.tokens[b].ts - store.tokens[a].ts);
      const newTokens = {};
      for (let i = 0; i < STORE_MAX; i++) newTokens[sorted[i]] = store.tokens[sorted[i]];
      store.tokens = newTokens;
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (e) {}
}
loadStore();

// --- Extraktion ---
function extractTokenAddresses(text) {
  if (!text) return [];
  const regex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const matches = text.match(regex);
  return matches ? [...new Set(matches)] : [];
}

// --- Analyse Logik (DexScreener API) ---
async function analyzeToken(address) {
  const result = {
    address,
    symbol: 'UNK',
    name: 'Unknown',
    score: 0,
    imageUrl: null,
    mc: 0,
    price: 0,
    liq: 0,
    vol24: 0,
    change5m: 0,
    change1h: 0,
    change6h: 0,
    change24h: 0,
    buys: 0,
    sells: 0,
    ageMins: 0,
    riskFactors: []
  };

  try {
    // DexScreener Fetch
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const data = await res.json();

    if (data && data.pairs && data.pairs.length > 0) {
      const pair = data.pairs.find(p => p.chainId === 'solana') || data.pairs[0];
      
      result.symbol = pair.baseToken.symbol || 'UNK';
      result.name = pair.baseToken.name || 'Unknown';
      result.imageUrl = pair.info?.imageUrl || null;
      result.mc = pair.fdv || pair.marketCap || 0;
      result.price = pair.priceUsd || 0;
      result.liq = pair.liquidity?.usd || 0;
      result.vol24 = pair.volume?.h24 || 0;
      
      result.change5m = pair.priceChange?.m5 || 0;
      result.change1h = pair.priceChange?.h1 || 0;
      result.change6h = pair.priceChange?.h6 || 0;
      result.change24h = pair.priceChange?.h24 || 0;
      
      result.buys = pair.txns?.h24?.buys || 0;
      result.sells = pair.txns?.h24?.sells || 0;
      
      const pairAgeMins = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : 999;
      result.ageMins = Math.round(pairAgeMins);

      // Simple Scoring System
      let score = 50; 
      
      if (result.liq > 10000) { score += 15; result.riskFactors.push('✅ +15 Liquidity > $10k'); }
      else { score -= 20; result.riskFactors.push('❌ -20 Low Liquidity'); }

      if (result.vol24 > 50000) { score += 15; result.riskFactors.push('✅ +15 Good Volume'); }
      
      if (result.buys > result.sells * 1.2) { score += 10; result.riskFactors.push('✅ +10 Good Buy/Sell Ratio'); }

      if (result.ageMins < 60) { score -= 10; result.riskFactors.push('❌ -10 Token is very new (< 1h)'); }
      else { score += 10; result.riskFactors.push('✅ +10 Token age > 1h'); }

      result.score = Math.max(0, Math.min(100, score)); // Max 100, Min 0
    }
  } catch (e) {
    console.warn(`[analyze] DexScreener Fetch Fehler für ${address}`);
  }

  return result;
}

// --- Formatierung für Telegram ---
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return parseFloat(num).toFixed(2);
}

function formatMessage(a) {
  let status = '🔴 SCAM/RUG RISK';
  if (a.score >= 80) status = '🟩 LIKELY SAFE';
  else if (a.score >= 50) status = '🟨 MEDIUM RISK';

  let txt = `🔍 *RUG ANALYSIS: ${a.name} ($${a.symbol})*\n`;
  txt += `🛡 Score: ${a.score}/100 → ${status}\n`;
  txt += `🌱 Age: ${a.ageMins}m | ⛓ Solana\n\n`;

  txt += `📊 *Stats*\n`;
  txt += `➰ MC:    $${formatNumber(a.mc)}\n`;
  txt += `➰ Price: $${a.price}\n`;
  txt += `➰ LIQ:   $${formatNumber(a.liq)}\n`;
  txt += `➰ Vol:   $${formatNumber(a.vol24)} (24h)\n\n`;

  txt += `📈 *Change*\n`;
  txt += `➰ 5M / 1H / 24H: ${a.change5m}% / ${a.change1h}% / ${a.change24h}%\n\n`;

  txt += `📉 *Trades 24H*\n`;
  txt += `➰ Buys: ${a.buys} | Sells: ${a.sells}\n\n`;

  txt += `✅❌ *Risk Factors*\n`;
  a.riskFactors.forEach(r => txt += `   ${r}\n`);
  
  txt += `\n📍 *Token:* \`${a.address}\`\n\n`;
  txt += `📊 [DexScreener](https://dexscreener.com/solana/${a.address}) • [Birdeye](https://birdeye.so/token/${a.address}?chain=solana)\n`;
  txt += `🤖 *Trade:* [Trojan](https://t.me/solana_trojanbot?start=r-${a.address}) • [Maestro](https://t.me/MaestroSniperBot?start=${a.address}-solana)`;

  return txt;
}

// ===========================================================================
// TELEGRAM USERBOT LOGIN (GramJS)
// ===========================================================================

const stringSession = new StringSession(SESSION_STRING);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let lastForwardAt = 0;
const inflight = new Set();

async function sendAnalysisTo(targetChat, analysis) {
  const caption = formatMessage(analysis);

  try {
    if (analysis.imageUrl) {
      await client.sendFile(targetChat, { file: analysis.imageUrl, caption: caption, parseMode: 'markdown' });
    } else {
      await client.sendMessage(targetChat, { message: caption, parseMode: 'markdown' });
    }
  } catch (e) {
    console.error('[send] Fehler beim Senden:', e.message);
  }
}

async function processAddress(address) {
  if (inflight.has(address)) return;
  inflight.add(address);
  try {
    const cached = store.tokens[address];
    if (cached && (Date.now() - cached.ts < REANALYZE_AFTER_MS)) return;

    let analysis = await analyzeToken(address);

    store.tokens[address] = { ts: Date.now(), score: analysis.score };
    saveStore();

    if (analysis.score >= MIN_FORWARD_SCORE) {
      const wait = Math.max(0, lastForwardAt + RATE_LIMIT_MS - Date.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      await sendAnalysisTo(FORWARD_CHAT_ID, analysis);
      lastForwardAt = Date.now();
      console.log(`[fwd] → Erfolgreich weitergeleitet (Score: ${analysis.score})`);
    } else {
      console.log(`[block] Token abgelehnt. Score (${analysis.score}) ist unter Minimum (${MIN_FORWARD_SCORE}).`);
    }
  } catch (e) {
    console.warn('[analyze] Fehler:', e.message);
  } finally {
    inflight.delete(address);
  }
}

// Event-Listener für neue Nachrichten
client.addEventHandler(async (event) => {
  const message = event.message;
  const chatId = message.chatId ? message.chatId.toString() : '';
  const senderId = message.senderId ? message.senderId.toString() : '';
  const chatUsername = message.chat && message.chat.username ? message.chat.username : '';
  const text = message.text || '';

  const isSource = SOURCE_CHAT_IDS.includes(chatId) || 
                   SOURCE_CHAT_IDS.includes('-100' + chatId) || 
                   SOURCE_CHAT_IDS.includes(senderId) || 
                   SOURCE_CHAT_IDS.includes('@' + chatUsername);

  if (!isSource) return;

  const addrs = extractTokenAddresses(text);
  if (!addrs.length) return;

  console.log(`[recv] ${addrs.length} CAs gefunden.`);
  for (const a of addrs) {
    processAddress(a).catch(e => console.warn(e.message));
  }
}, new NewMessage({}));

// --- Login & Start ---
(async () => {
  console.log('[boot] Starte Telegram Userbot Login...');
  await client.start({
    phoneNumber: async () => await input.text('Handynummer (+49...): '),
    password: async () => await input.text('2FA Passwort: '),
    phoneCode: async () => await input.text('Telegram-Code: '),
    onError: (err) => console.log(err),
  });

  console.log('\n✅ Erfolgreich als User eingeloggt!');
  const newSession = client.session.save();
  if (!SESSION_STRING) {
    console.log('\n=== TRAGE DIESEN STRING IN DEINE .env UNTER TELEGRAM_SESSION EIN ===');
    console.log(newSession);
    console.log('===================================================================\n');
  }

  console.log(`[boot] Bot läuft und überwacht: ${SOURCE_CHAT_IDS.join(', ')}`);
})();
