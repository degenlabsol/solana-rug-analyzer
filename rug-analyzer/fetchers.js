'use strict';

const fetch = require('node-fetch');
const { config } = require('./config');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function safeFetch(url, opts = {}, timeoutMs = config.bot.fetchTimeoutMs) {
  for (let attempt = 0; attempt < config.bot.fetchRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt < config.bot.fetchRetries - 1) await sleep(600);
    }
  }
  return null;
}

async function getDexPair(addr) {
  const data = await safeFetch(`https://api.dexscreener.com/token-pairs/v1/solana/${addr}`);
  if (!Array.isArray(data) || !data.length) return null;
  data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return data[0];
}

async function getDexLatestProfiles() {
  const data = await safeFetch('https://api.dexscreener.com/token-profiles/latest/v1');
  if (!Array.isArray(data)) return [];
  return data.filter(t => t.chainId === 'solana');
}

async function getGeckoToken(addr) {
  const data = await safeFetch(
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${addr}`,
    { headers: { accept: 'application/json' } }
  );
  return data?.data?.attributes || null;
}

async function getGeckoInfo(addr) {
  const data = await safeFetch(
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${addr}/info`,
    { headers: { accept: 'application/json' } }
  );
  return data?.data?.attributes || null;
}

async function getRugCheck(addr) {
  const data = await safeFetch(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
  return data || null;
}

async function getBirdeyeHolders(addr) {
  if (!config.api.birdeyeKey) return null;
  const data = await safeFetch(
    `https://public-api.birdeye.so/defi/v3/token/holder?address=${addr}&offset=0&limit=10`,
    { headers: { 'X-API-KEY': config.api.birdeyeKey, 'x-chain': 'solana' } }
  );
  return data?.data || null;
}

async function getHeliusAsset(addr) {
  if (!config.api.heliusKey) return null;
  const data = await safeFetch(
    `https://mainnet.helius-rpc.com/?api-key=${config.api.heliusKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }),
    }
  );
  return data?.result || null;
}

async function getHeliusDeployerHistory(deployer) {
  if (!config.api.heliusKey || !deployer) return null;
  const data = await safeFetch(
    `https://api.helius.xyz/v0/addresses/${deployer}/transactions?api-key=${config.api.heliusKey}&limit=50&type=CREATE_TOKEN`
  );
  return Array.isArray(data) ? data : null;
}

module.exports = {
  getDexPair,
  getDexLatestProfiles,
  getGeckoToken,
  getGeckoInfo,
  getRugCheck,
  getBirdeyeHolders,
  getHeliusAsset,
  getHeliusDeployerHistory,
};
