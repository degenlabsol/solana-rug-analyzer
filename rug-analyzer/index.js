'use strict';

require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');

const { config, validate } = require('./config');
const {
  getDexPair,
  getDexLatestProfiles,
  getGeckoToken,
  getGeckoInfo,
  getRugCheck,
  getBirdeyeHolders,
  getHeliusAsset,
  getHeliusDeployerHistory,
} = require('./fetchers');
const { hardReject, calcScore, ageStr, fmt } = require('./analyzer');
const { buildRugPost, buildPumperUpdate } = require('./message');

process.on('uncaughtException',  e => console.error('⚠️  Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('⚠️  Unhandled:', e?.message || e));
process.on('SIGINT', () => { console.log('👋 Bot gestoppt.'); process.exit(0); });

validate();

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
const candidatePool  = new Map();   // addr → { addr, pair, addedAt }
const postedTokens   = new Set();   // addr → never post twice
const pumperTracked  = new Map();   // addr → { symbol, entryMc, notifiedMultiples: Set }
let lastPostTime     = 0;
let isPosting        = false;
const RAYDIUM_WALLET = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────
// TELEGRAM CLIENT
// ─────────────────────────────────────────
const client = new TelegramClient(
  new StringSession(config.telegram.session),
  config.telegram.apiId,
  config.telegram.apiHash,
  {
    connectionRetries: Infinity,
    retryDelay:        3000,
    autoReconnect:     true,
    floodSleepThreshold: 120,
  }
);

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function isSolanaAddr(str) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str);
}

function extractAddresses(text) {
  const matches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
  return [...new Set(matches)].filter(isSolanaAddr);
}

function expirePool() {
  const cutoff = Date.now() - config.bot.poolTtlMs;
  for (const [addr, cand] of candidatePool) {
    if (cand.addedAt < cutoff) {
      candidatePool.delete(addr);
      console.log(`🗑  Pool expired: ${addr.slice(0, 8)}...`);
    }
  }
}

// ─────────────────────────────────────────
// QUICK PRE-CHECK (only DexScreener — cheap)
// ─────────────────────────────────────────
async function preCheck(addr) {
  const pair = await getDexPair(addr);
  if (!pair) return null;

  const liq  = pair.liquidity?.usd || 0;
  const vol  = pair.volume?.h24    || 0;
  const ch5m = pair.priceChange?.m5 || 0;

  if (liq < config.bot.minLiquidityUsd) return null;
  if (vol < 500)                         return null;
  if (ch5m <= config.bot.devNukeThreshold) return null;

  return pair;
}

// ─────────────────────────────────────────
// DEEP ANALYSIS + POST
// ─────────────────────────────────────────
async function deepAnalyzeAndPost(addr, pair) {
  try {
    console.log(`🔎 Deep-Check: ${pair?.baseToken?.symbol || addr.slice(0, 8)}`);

    const [rugcheck, gt, gtInfo, birdeyeData, heliusAsset] = await Promise.all([
      getRugCheck(addr),
      getGeckoToken(addr),
      getGeckoInfo(addr),
      getBirdeyeHolders(addr),
      getHeliusAsset(addr),
    ]);

    // Hard filters
    const rejectReason = hardReject(pair, rugcheck);
    if (rejectReason) {
      console.log(`❌ Hard-Reject [${pair?.baseToken?.symbol || '?'}]: ${rejectReason}`);
      return false;
    }

    // Top-10 holder check (Raydium excluded)
    if (birdeyeData?.items) {
      const nonRaydium = birdeyeData.items.filter(h => h.address !== RAYDIUM_WALLET);
      const total = nonRaydium.reduce((s, h) => s + (h.uiAmount || 0), 0);
      const top10 = nonRaydium.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
      const pct10 = total > 0 ? (top10 / total) * 100 : 0;
      if (pct10 > config.bot.maxTop10PctHardReject) {
        console.log(`❌ Top-10 zu hoch [${pair?.baseToken?.symbol}]: ${pct10.toFixed(1)}%`);
        return false;
      }
    }

    // Deployer history (optional — only if helius available)
    let deployerTxs = null;
    const deployer = rugcheck?.creator || heliusAsset?.authorities?.find(a => a.scopes?.includes('mint'))?.address;
    if (deployer) {
      deployerTxs = await getHeliusDeployerHistory(deployer);
    }

    // Score
    const scoring = calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck);
    console.log(`📊 Score: ${scoring.score}/100 → ${scoring.emoji} ${scoring.label} [${pair?.baseToken?.symbol}]`);

    if (scoring.score < 30) {
      console.log(`⚠️  Score zu niedrig, skip.`);
      return false;
    }

    // Build & send message
    const { msg, imageUrl } = buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck);

    if (imageUrl) {
      try {
        await client.sendFile(config.telegram.postChatId, {
          file:       imageUrl,
          caption:    msg,
          parseMode:  'markdown',
          linkPreview: false,
        });
      } catch {
        await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
      }
    } else {
      await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
    }

    const mc = pair?.marketCap || pair?.fdv || 0;
    if (mc > 0) {
      pumperTracked.set(addr, { symbol: pair?.baseToken?.symbol || '?', entryMc: mc, notifiedMultiples: new Set() });
    }

    console.log(`🏆 POSTED: ${pair?.baseToken?.symbol} | MC: $${fmt(mc)} | Score: ${scoring.score}/100`);
    return true;

  } catch (e) {
    console.error(`💥 deepAnalyzeAndPost error [${addr.slice(0, 8)}]:`, e.message);
    return false;
  }
}

// ─────────────────────────────────────────
// POST QUEUE PROCESSOR
// ─────────────────────────────────────────
async function processQueue() {
  if (isPosting || candidatePool.size === 0) return;
  if (Date.now() - lastPostTime < config.bot.postCooldownMs) return;

  isPosting = true;
  try {
    expirePool();

    // Pick best candidate: highest liquidity
    let bestAddr = null, bestLiq = 0;
    for (const [addr, cand] of candidatePool) {
      const liq = cand.pair?.liquidity?.usd || 0;
      if (liq > bestLiq) { bestLiq = liq; bestAddr = addr; }
    }

    if (!bestAddr) return;

    const cand = candidatePool.get(bestAddr);
    candidatePool.delete(bestAddr);

    if (postedTokens.has(bestAddr)) return;

    // Re-fetch fresh pair data before deep check
    const freshPair = await getDexPair(bestAddr) || cand.pair;
    const posted = await deepAnalyzeAndPost(bestAddr, freshPair);
    if (posted) {
      postedTokens.add(bestAddr);
      lastPostTime = Date.now();
    }
  } finally {
    isPosting = false;
  }
}

// ─────────────────────────────────────────
// PUMPER TRACKER (every 12 min)
// ─────────────────────────────────────────
async function checkPumpers() {
  if (pumperTracked.size === 0) return;
  console.log(`📈 Pumper-Check: ${pumperTracked.size} Token...`);

  for (const [addr, info] of pumperTracked) {
    try {
      const pair = await getDexPair(addr);
      if (!pair) continue;

      const currentMc = pair.marketCap || pair.fdv || 0;
      if (!currentMc || !info.entryMc) continue;

      const multiple = Math.floor(currentMc / info.entryMc);
      if (multiple < 2) continue;

      for (const target of config.bot.pumperMultiples) {
        if (multiple >= target && !info.notifiedMultiples.has(target)) {
          info.notifiedMultiples.add(target);
          const msg = buildPumperUpdate(info.symbol, addr, info.entryMc, currentMc, target);
          await client.sendMessage(config.telegram.postChatId, { message: msg, linkPreview: false });
          console.log(`🚀 Pumper Update: ${info.symbol} ${target}X!`);
          await sleep(3000);
        }
      }
    } catch (e) {
      console.error(`Pumper check error [${addr.slice(0, 8)}]:`, e.message);
    }
  }
}

// ─────────────────────────────────────────
// FALLBACK: DexScreener Latest Token Profiles
// ─────────────────────────────────────────
async function pollDexLatest() {
  try {
    const profiles = await getDexLatestProfiles();
    let found = 0;
    for (const token of profiles) {
      const addr = token.tokenAddress;
      if (!addr || postedTokens.has(addr) || candidatePool.has(addr)) continue;
      const pair = await preCheck(addr);
      if (pair) {
        candidatePool.set(addr, { addr, pair, addedAt: Date.now() });
        found++;
      }
    }
    if (found > 0) console.log(`🔄 DexScreener Fallback: ${found} neue Kandidaten`);
  } catch (e) {
    console.error('DexScreener Fallback error:', e.message);
  }
}

// ─────────────────────────────────────────
// TELEGRAM MESSAGE HANDLER
// ─────────────────────────────────────────
async function handleMessage(event) {
  try {
    if (event.message.out) return;
    const text = event.message.message || '';
    if (!text) return;

    const addrs = extractAddresses(text);
    if (!addrs.length) return;

    for (const addr of addrs) {
      if (postedTokens.has(addr) || candidatePool.has(addr)) continue;

      const pair = await preCheck(addr);
      if (pair) {
        candidatePool.set(addr, { addr, pair, addedAt: Date.now() });
        console.log(`📥 TG-Kandidat: ${pair.baseToken?.symbol || addr.slice(0, 8)} | Liq: $${fmt(pair.liquidity?.usd || 0)}`);
      }
    }
  } catch (e) {
    console.error('handleMessage error:', e.message);
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  🕵️  RUG ANALYZER PRO — Elite Sniper v2  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  await client.connect();
  const me = await client.getMe();
  console.log(`🚀 Eingeloggt als: @${me.username || me.firstName}`);
  console.log(`📡 Überwache: ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`📤 Poste nach: ${config.telegram.postChatId}`);
  console.log('');

  // Listen to Telegram source chats
  const sourceFilter = config.telegram.sourceChatIds.length
    ? { chats: config.telegram.sourceChatIds }
    : {};

  client.addEventHandler(handleMessage, new NewMessage(sourceFilter));
  console.log('👂 Telegram Listener aktiv');

  // Main processing loop: every 5 seconds
  setInterval(processQueue, 5000);

  // Pumper check: every 12 minutes
  setInterval(checkPumpers, config.bot.pumperCheckMs);

  // Fallback: DexScreener latest profiles every 3 minutes
  setInterval(pollDexLatest, 3 * 60 * 1000);
  await pollDexLatest();

  console.log('✅ Bot läuft — 24/7 aktiv!');
  console.log('');

  // Keep alive
  setInterval(() => {}, 60000);
}

main().catch(e => {
  console.error('💥 FATAL:', e.message);
  process.exit(1);
});
