'use strict';

const fetch  = require('node-fetch');
const { config } = require('./config');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────
// RATE-LIMITED FETCH
// ─────────────────────────────────────────
const lastCallAt = {};

async function rateLimitedFetch(key, url, opts = {}) {
  const minGap = config.bot.dexRateLimitMs;
  const now    = Date.now();
  const gap    = now - (lastCallAt[key] || 0);
  if (gap < minGap) await sleep(minGap - gap);
  lastCallAt[key] = Date.now();

  for (let attempt = 0; attempt < config.bot.fetchRetries; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.bot.fetchTimeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429) { await sleep(5000); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      if (attempt < config.bot.fetchRetries - 1) await sleep(800);
    }
  }
  return null;
}

// ─────────────────────────────────────────
// DEX SCREENER  — rotating endpoints
// ─────────────────────────────────────────
const DEX_PAIR_ENDPOINTS = [
  addr => `https://api.dexscreener.com/token-pairs/v1/solana/${addr}`,
  addr => `https://api.dexscreener.com/tokens/v1/solana/${addr}`,
];
let dexPairIdx = 0;

async function getDexPair(addr) {
  for (let i = 0; i < DEX_PAIR_ENDPOINTS.length; i++) {
    const idx  = (dexPairIdx + i) % DEX_PAIR_ENDPOINTS.length;
    const url  = DEX_PAIR_ENDPOINTS[idx](addr);
    const key  = `dex_pair_${idx}`;
    const data = await rateLimitedFetch(key, url);
    if (!data) continue;

    // /token-pairs/v1 returns array; /tokens/v1 returns { pairs: [...] }
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    if (!pairs.length) continue;

    dexPairIdx = (idx + 1) % DEX_PAIR_ENDPOINTS.length;
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return pairs[0];
  }
  return null;
}

async function getDexLatestProfiles() {
  const data = await rateLimitedFetch('dex_profiles',
    'https://api.dexscreener.com/token-profiles/latest/v1');
  if (!Array.isArray(data)) return [];
  return data.filter(t => t.chainId === 'solana');
}

async function getDexLatestBoosts() {
  const data = await rateLimitedFetch('dex_boosts',
    'https://api.dexscreener.com/token-boosts/latest/v1');
  if (!Array.isArray(data)) return [];
  return data.filter(t => t.chainId === 'solana');
}

async function getDexActiveBoosts() {
  const data = await rateLimitedFetch('dex_boosts_active',
    'https://api.dexscreener.com/token-boosts/active/v1');
  if (!Array.isArray(data)) return [];
  return data.filter(t => t.chainId === 'solana');
}

// ─────────────────────────────────────────
// GECKO TERMINAL
// ─────────────────────────────────────────
async function getGeckoToken(addr) {
  const data = await rateLimitedFetch('gecko_token',
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${addr}`,
    { headers: { accept: 'application/json' } });
  return data?.data?.attributes || null;
}

async function getGeckoInfo(addr) {
  const data = await rateLimitedFetch('gecko_info',
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${addr}/info`,
    { headers: { accept: 'application/json' } });
  return data?.data?.attributes || null;
}

// ─────────────────────────────────────────
// RUG CHECK
// ─────────────────────────────────────────
async function getRugCheck(addr) {
  return await rateLimitedFetch('rugcheck',
    `https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
}

// ─────────────────────────────────────────
// BIRDEYE
// ─────────────────────────────────────────
async function getBirdeyeHolders(addr) {
  if (!config.api.birdeyeKey) return null;
  const data = await rateLimitedFetch('birdeye_holders',
    `https://public-api.birdeye.so/defi/v3/token/holder?address=${addr}&offset=0&limit=20`,
    { headers: { 'X-API-KEY': config.api.birdeyeKey, 'x-chain': 'solana' } });
  return data?.data || null;
}

// ─────────────────────────────────────────
// HELIUS
// ─────────────────────────────────────────
async function getHeliusAsset(addr) {
  if (!config.api.heliusKey) return null;
  const data = await rateLimitedFetch('helius_asset',
    `https://mainnet.helius-rpc.com/?api-key=${config.api.heliusKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }),
    });
  return data?.result || null;
}

async function getHeliusDeployerHistory(deployer) {
  if (!config.api.heliusKey || !deployer) return null;
  const data = await rateLimitedFetch('helius_history',
    `https://api.helius.xyz/v0/addresses/${deployer}/transactions?api-key=${config.api.heliusKey}&limit=50&type=CREATE_TOKEN`);
  return Array.isArray(data) ? data : null;
}

// ─────────────────────────────────────────
// OPEN ROUTER — Daily Market Update
// ─────────────────────────────────────────
async function getMarketUpdateFromAI(topGainers, totalPosted) {
  if (!config.api.openRouterKey) return null;

  const topStr = topGainers.slice(0, 5)
    .map((t, i) => `${i + 1}. $${t.symbol} +${t.multiple}X (MC: $${t.currentMc})`)
    .join('\n');

  const prompt =
`You are a Solana crypto analyst. Write a concise daily market update for a Telegram channel (max 180 words).
Tone: professional, data-driven, no hype.
Today's top early callers: ${topStr || 'none yet'}.
Total tokens analyzed today: ${totalPosted}.
Include: brief sentiment (bullish/bearish/neutral), key trends, risk reminder.
Write in English only. No markdown headers. Start with 📊 Daily Market Update.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${config.api.openRouterKey}`,
        'HTTP-Referer':  'https://github.com/degenlabsol/solana-rug-analyzer',
        'X-Title':       'Solana Rug Analyzer',
      },
      body: JSON.stringify({
        model: config.api.openRouterModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      }),
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

module.exports = {
  getDexPair,
  getDexLatestProfiles,
  getDexLatestBoosts,
  getDexActiveBoosts,
  getGeckoToken,
  getGeckoInfo,
  getRugCheck,
  getBirdeyeHolders,
  getHeliusAsset,
  getHeliusDeployerHistory,
  getMarketUpdateFromAI,
};
