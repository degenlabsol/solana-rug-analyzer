'use strict';

require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');

const { config, validate }              = require('./config');
const {
  getDexPair, getDexLatestProfiles, getDexLatestBoosts, getDexActiveBoosts,
  getGeckoToken, getGeckoInfo, getRugCheck,
  getBirdeyeHolders, getHeliusAsset, getHeliusDeployerHistory,
  getMarketUpdateFromAI,
} = require('./fetchers');
const { hardReject, calcScore, ageStr, fmt } = require('./analyzer');
const { buildRugPost, buildPumperUpdate, buildLeaderboard, buildMarketUpdate } = require('./message');

// ─── Anti-crash ──────────────────────────────────────────────────────────────
process.on('uncaughtException',  e => console.error('⚠️  Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('⚠️  Unhandled:', e?.message || e));
process.on('SIGINT', () => { console.log('👋 Bot stopped.'); process.exit(0); });

validate();

// ─── State ───────────────────────────────────────────────────────────────────
const candidatePool = new Map();   // addr → { addr, pair, addedAt }
const postedTokens  = new Set();   // dedupe guard
const pumperTracked = new Map();   // addr → { symbol, name, entryMc, notifiedMultiples, tgUrl, xUrl }
const leaderboard   = new Map();   // addr → { symbol, name, entryMc, currentMc, multiple, tgUrl, xUrl, postedAt }
let   lastPostTime  = 0;
let   isPosting     = false;

const RAYDIUM_WALLET = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Telegram Client ─────────────────────────────────────────────────────────
const client = new TelegramClient(
  new StringSession(config.telegram.session),
  config.telegram.apiId,
  config.telegram.apiHash,
  {
    connectionRetries:   Infinity,
    retryDelay:          3000,
    autoReconnect:       true,
    floodSleepThreshold: 120,
  }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isSolanaAddr(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function extractAddresses(text) {
  const matches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
  return [...new Set(matches)].filter(isSolanaAddr);
}

function expirePool() {
  const cutoff = Date.now() - config.bot.poolTtlMs;
  for (const [addr, c] of candidatePool) {
    if (c.addedAt < cutoff) {
      candidatePool.delete(addr);
      console.log(`🗑  Pool expired: ${addr.slice(0, 8)}...`);
    }
  }
}

// ─── Quick pre-check (DexScreener only — cheap & fast) ───────────────────────
async function preCheck(addr) {
  const pair = await getDexPair(addr);
  if (!pair) return null;

  const liq  = pair.liquidity?.usd  || 0;
  const vol  = pair.volume?.h24     || 0;
  const ch5m = pair.priceChange?.m5 || 0;

  if (liq  <  config.bot.minLiquidityUsd)  return null;
  if (vol  <  500)                          return null;
  if (ch5m <= config.bot.devNukeThreshold)  return null;

  return pair;
}

// ─── Send ONE message: try with photo, fall back to text ─────────────────────
async function sendPost(msg, imageUrl) {
  const chatId     = config.telegram.postChatId;
  const parseMode  = 'markdown';
  const linkPreview = true;   // enables DexScreener chart preview image

  if (imageUrl) {
    try {
      await client.sendFile(chatId, {
        file:        imageUrl,
        caption:     msg.slice(0, 1024),  // Telegram caption hard limit
        parseMode,
        linkPreview: false,
      });
      return;
    } catch { /* fall through */ }
  }

  // Single text message — DexScreener link at bottom generates chart preview
  await client.sendMessage(chatId, { message: msg, parseMode, linkPreview });
}

// ─── Deep analysis + post ─────────────────────────────────────────────────────
async function deepAnalyzeAndPost(addr, pair) {
  try {
    const sym = pair?.baseToken?.symbol || addr.slice(0, 8);
    console.log(`🔎 Deep-Check: ${sym}`);

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
      console.log(`❌ Hard-Reject [${sym}]: ${rejectReason}`);
      return false;
    }

    // Top-10 holder hard reject (Raydium excluded)
    if (birdeyeData?.items) {
      const nonRay  = birdeyeData.items.filter(h => h.address !== RAYDIUM_WALLET);
      const total   = nonRay.reduce((s, h) => s + (h.uiAmount || 0), 0);
      const top10   = nonRay.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
      const pct10   = total > 0 ? (top10 / total) * 100 : 0;
      if (pct10 > config.bot.maxTop10PctHardReject) {
        console.log(`❌ Top-10 too high [${sym}]: ${pct10.toFixed(1)}%`);
        return false;
      }
    }

    // Deployer history
    let deployerTxs = null;
    const deployer  = rugcheck?.creator
      || heliusAsset?.authorities?.find(a => a.scopes?.includes('mint'))?.address;
    if (deployer) deployerTxs = await getHeliusDeployerHistory(deployer);

    // Score
    const scoring = calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck);
    console.log(`📊 Score: ${scoring.score}/100 → ${scoring.emoji} ${scoring.label} [${sym}]`);

    if (scoring.score < config.bot.minScore) {
      console.log(`⚠️  Score too low (${scoring.score}), skipped.`);
      return false;
    }

    // Build & send ONE message
    const { msg, imageUrl } = buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck);
    await sendPost(msg, imageUrl);

    // Track for pumper & leaderboard
    const mc  = pair?.marketCap || pair?.fdv || 0;
    const soc = pair?.info?.socials || [];
    const tgUrl = soc.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url || null;
    const xUrl  = soc.find(s => s.type === 'twitter'  || s.url?.includes('x.com'))?.url || null;

    if (mc > 0) {
      const entry = {
        symbol: sym,
        name:   pair?.baseToken?.name || sym,
        entryMc: mc,
        notifiedMultiples: new Set(),
        tgUrl, xUrl,
      };
      pumperTracked.set(addr, entry);
      leaderboard.set(addr, {
        symbol: sym,
        name:   pair?.baseToken?.name || sym,
        entryMc: mc, currentMc: mc, multiple: 1,
        tgUrl, xUrl,
        postedAt: Date.now(),
      });
    }

    console.log(`🏆 POSTED: ${sym} | MC: $${fmt(mc)} | Score: ${scoring.score}/100`);
    return true;

  } catch (e) {
    console.error(`💥 deepAnalyzeAndPost [${addr.slice(0, 8)}]:`, e.message);
    return false;
  }
}

// ─── Process best candidate from pool ────────────────────────────────────────
async function processQueue() {
  if (isPosting || candidatePool.size === 0) return;
  if (Date.now() - lastPostTime < config.bot.postCooldownMs) return;

  isPosting = true;
  try {
    expirePool();

    let bestAddr = null, bestLiq = 0;
    for (const [addr, c] of candidatePool) {
      const liq = c.pair?.liquidity?.usd || 0;
      if (liq > bestLiq) { bestLiq = liq; bestAddr = addr; }
    }
    if (!bestAddr) return;

    const cand = candidatePool.get(bestAddr);
    candidatePool.delete(bestAddr);
    if (postedTokens.has(bestAddr)) return;

    const freshPair = await getDexPair(bestAddr) || cand.pair;
    const posted    = await deepAnalyzeAndPost(bestAddr, freshPair);
    if (posted) {
      postedTokens.add(bestAddr);
      lastPostTime = Date.now();
    }
  } finally {
    isPosting = false;
  }
}

// ─── Pumper tracker ───────────────────────────────────────────────────────────
async function checkPumpers() {
  if (!pumperTracked.size) return;
  console.log(`📈 Pumper check: ${pumperTracked.size} tokens…`);

  for (const [addr, info] of pumperTracked) {
    try {
      const pair      = await getDexPair(addr);
      if (!pair) continue;

      const currentMc = pair.marketCap || pair.fdv || 0;
      if (!currentMc || !info.entryMc) continue;

      const multiple  = Math.floor(currentMc / info.entryMc);
      if (multiple < 2) continue;

      // Update leaderboard
      const lb = leaderboard.get(addr);
      if (lb) { lb.currentMc = currentMc; lb.multiple = multiple; }

      for (const target of config.bot.pumperMultiples) {
        if (multiple >= target && !info.notifiedMultiples.has(target)) {
          info.notifiedMultiples.add(target);
          const msg = buildPumperUpdate(info.symbol, addr, info.entryMc, currentMc, target);
          await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
          console.log(`🚀 Pumper: ${info.symbol} ${target}X!`);
          await sleep(3000);
        }
      }
    } catch (e) {
      console.error(`Pumper check error [${addr.slice(0, 8)}]:`, e.message);
    }
  }
}

// ─── Leaderboard post ─────────────────────────────────────────────────────────
async function postLeaderboard() {
  const entries = [...leaderboard.values()].filter(e => e.multiple >= 2);
  if (!entries.length) {
    console.log('📊 Leaderboard: no entries with 2X+ yet, skip.');
    return;
  }

  const msg = buildLeaderboard(entries, config.bot.leaderboardSize);
  if (!msg) return;

  try {
    await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
    console.log(`📊 Leaderboard posted (${entries.length} entries)`);
  } catch (e) {
    console.error('Leaderboard post error:', e.message);
  }
}

// ─── Daily AI market update ───────────────────────────────────────────────────
async function postMarketUpdate() {
  if (!config.api.openRouterKey) return;

  const topGainers = [...leaderboard.values()]
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, 5)
    .map(e => ({ symbol: e.symbol, multiple: e.multiple, currentMc: fmt(e.currentMc) }));

  const total   = postedTokens.size;
  const aiText  = await getMarketUpdateFromAI(topGainers, total);
  if (!aiText) { console.log('⚠️  Market update: no AI response'); return; }

  try {
    const msg = buildMarketUpdate(aiText);
    await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
    console.log('📰 Daily market update posted');
  } catch (e) {
    console.error('Market update post error:', e.message);
  }
}

// ─── Fallback pollers ─────────────────────────────────────────────────────────
async function addFromSources(tokens) {
  let found = 0;
  for (const token of tokens) {
    const addr = token.tokenAddress;
    if (!addr || postedTokens.has(addr) || candidatePool.has(addr)) continue;
    const pair = await preCheck(addr);
    if (pair) { candidatePool.set(addr, { addr, pair, addedAt: Date.now() }); found++; }
  }
  return found;
}

async function pollFallbacks() {
  try {
    const [profiles, boosts, active] = await Promise.all([
      getDexLatestProfiles(),
      getDexLatestBoosts(),
      getDexActiveBoosts(),
    ]);

    const merged = [...profiles, ...boosts, ...active];
    const found  = await addFromSources(merged);
    if (found > 0) console.log(`🔄 Fallback pollers: +${found} new candidates`);
  } catch (e) {
    console.error('Fallback poller error:', e.message);
  }
}

// ─── Telegram message handler ─────────────────────────────────────────────────
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
        console.log(`📥 TG candidate: ${pair.baseToken?.symbol || addr.slice(0, 8)} | Liq: $${fmt(pair.liquidity?.usd || 0)}`);
      }
    }
  } catch (e) {
    console.error('handleMessage error:', e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🕵️   RUG ANALYZER PRO — Elite Sniper v3    ║');
  console.log('║  24/7 Solana Rug Filter & Elite Call Bot     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  await client.connect();
  const me = await client.getMe();
  console.log(`🚀 Logged in as: @${me.username || me.firstName}`);
  console.log(`📡 Monitoring  : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`📤 Posting to  : ${config.telegram.postChatId}`);
  console.log('');

  // Listen to source chats
  const filter = config.telegram.sourceChatIds.length
    ? { chats: config.telegram.sourceChatIds }
    : {};
  client.addEventHandler(handleMessage, new NewMessage(filter));
  console.log('👂 Telegram listener active');

  // Process queue every 5s
  setInterval(processQueue, 5000);

  // Pumper tracker every 12min
  setInterval(checkPumpers, config.bot.pumperCheckMs);

  // Leaderboard every 6h (configurable)
  setInterval(postLeaderboard, config.bot.leaderboardIntervalMs);

  // Daily market update (configurable)
  setInterval(postMarketUpdate, config.bot.marketUpdateIntervalMs);

  // Fallback pollers every 3min
  setInterval(pollFallbacks, 3 * 60 * 1000);
  await pollFallbacks();   // run immediately on start

  console.log('✅ Bot is live — running 24/7!');
  console.log('');

  // Keep-alive
  setInterval(() => {}, 60000);
}

main().catch(e => {
  console.error('💥 FATAL:', e.message);
  process.exit(1);
});
