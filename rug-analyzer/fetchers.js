'use strict';

const fetch  = require('node-fetch');
const { config } = require('./config');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Rate-limited fetch — sequential, low memory ──────────────────────────────
const lastCallAt = {};

async function rateLimitedFetch(key, url, opts = {}) {
  const gap = Date.now() - (lastCallAt[key] || 0);
  if (gap < config.bot.dexRateLimitMs) await sleep(config.bot.dexRateLimitMs - gap);
  lastCallAt[key] = Date.now();

  for (let i = 0; i < config.bot.fetchRetries; i++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.bot.fetchTimeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429) { await sleep(6000); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch {
      clearTimeout(timer);
      if (i < config.bot.fetchRetries - 1) await sleep(1000);
    }
  }
  return null;
}

// ─── DexScreener — two endpoints, rotate ─────────────────────────────────────
let dexIdx = 0;
const DEX_FNS = [
  addr => `https://api.dexscreener.com/token-pairs/v1/solana/${addr}`,
  addr => `https://api.dexscreener.com/tokens/v1/solana/${addr}`,
];

async function getDexPair(addr) {
  for (let i = 0; i < DEX_FNS.length; i++) {
    const idx  = (dexIdx + i) % DEX_FNS.length;
    const data = await rateLimitedFetch(`dex${idx}`, DEX_FNS[idx](addr));
    if (!data) continue;
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    if (!pairs.length) continue;
    dexIdx = (idx + 1) % DEX_FNS.length;
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return pairs[0];
  }
  return null;
}

async function getDexLatestProfiles() {
  const data = await rateLimitedFetch('dex_prof', 'https://api.dexscreener.com/token-profiles/latest/v1');
  return Array.isArray(data) ? data.filter(t => t.chainId === 'solana') : [];
}

async function getDexLatestBoosts() {
  const data = await rateLimitedFetch('dex_boost', 'https://api.dexscreener.com/token-boosts/latest/v1');
  return Array.isArray(data) ? data.filter(t => t.chainId === 'solana') : [];
}

// ─── GeckoTerminal ────────────────────────────────────────────────────────────
async function getGeckoToken(addr) {
  const data = await rateLimitedFetch('gecko',
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

// ─── RugCheck ─────────────────────────────────────────────────────────────────
async function getRugCheck(addr) {
  return await rateLimitedFetch('rugcheck', `https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
}

// ─── Birdeye (optional) ───────────────────────────────────────────────────────
async function getBirdeyeHolders(addr) {
  if (!config.api.birdeyeKey) return null;
  const data = await rateLimitedFetch('birdeye',
    `https://public-api.birdeye.so/defi/v3/token/holder?address=${addr}&offset=0&limit=20`,
    { headers: { 'X-API-KEY': config.api.birdeyeKey, 'x-chain': 'solana' } });
  return data?.data || null;
}

// ─── Helius (optional) ────────────────────────────────────────────────────────
async function getHeliusAsset(addr) {
  if (!config.api.heliusKey) return null;
  const data = await rateLimitedFetch('helius_asset',
    `https://mainnet.helius-rpc.com/?api-key=${config.api.heliusKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }) });
  return data?.result || null;
}

async function getHeliusDeployerHistory(deployer) {
  if (!config.api.heliusKey || !deployer) return null;
  const data = await rateLimitedFetch('helius_hist',
    `https://api.helius.xyz/v0/addresses/${deployer}/transactions?api-key=${config.api.heliusKey}&limit=30&type=CREATE_TOKEN`);
  return Array.isArray(data) ? data : null;
}

module.exports = {
  getDexPair, getDexLatestProfiles, getDexLatestBoosts,
  getGeckoToken, getGeckoInfo, getRugCheck,
  getBirdeyeHolders, getHeliusAsset, getHeliusDeployerHistory,
};
