'use strict';

require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');

const { config, validate }   = require('./config');
const {
  getDexPair, getDexLatestProfiles, getDexLatestBoosts,
  getGeckoToken, getGeckoInfo, getRugCheck,
  getBirdeyeHolders, getHeliusAsset, getHeliusDeployerHistory,
} = require('./fetchers');
const { hardReject, calcScore, classifyToken, fmt } = require('./analyzer');
const { buildRugPost, buildPumperUpdate, buildLeaderboard } = require('./message');

process.on('uncaughtException',  e => console.error('⚠️ Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('⚠️ Unhandled:', e?.message || e));
process.on('SIGINT', () => { console.log('👋 Stopped.'); process.exit(0); });

validate();

// ─── Minimal state — keep RAM low ────────────────────────────────────────────
const candidatePool = new Map();  // addr → { pair, classification, addedAt }
const postedTokens  = new Set();
const pumperTracked = new Map();
const leaderboard   = new Map();
let   lastPostTime  = 0;
let   isPosting     = false;

const RAYDIUM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── Telegram client ──────────────────────────────────────────────────────────
const client = new TelegramClient(
  new StringSession(config.telegram.session),
  config.telegram.apiId, config.telegram.apiHash,
  { connectionRetries: Infinity, retryDelay: 4000, autoReconnect: true, floodSleepThreshold: 120 }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isSolAddr = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

function extractAddresses(text) {
  return [...new Set((text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || []))].filter(isSolAddr);
}

function prunePool() {
  // Expire old entries
  const cutoff = Date.now() - config.bot.poolTtlMs;
  for (const [addr, c] of candidatePool)
    if (c.addedAt < cutoff) candidatePool.delete(addr);

  // If pool too large, drop lowest priority
  if (candidatePool.size > config.bot.maxPoolSize) {
    const sorted = [...candidatePool.entries()]
      .sort((a, b) => candidatePriority(a[1]) - candidatePriority(b[1]));
    const toDrop = sorted.slice(0, candidatePool.size - config.bot.maxPoolSize);
    toDrop.forEach(([a]) => candidatePool.delete(a));
  }
}

function pruneLeaderboard() {
  if (leaderboard.size <= config.bot.maxLeaderboard) return;
  // Drop oldest entries
  const sorted = [...leaderboard.entries()].sort((a, b) => a[1].postedAt - b[1].postedAt);
  sorted.slice(0, leaderboard.size - config.bot.maxLeaderboard).forEach(([a]) => leaderboard.delete(a));
}

function candidatePriority(cand) {
  const mc  = cand.pair?.marketCap || cand.pair?.fdv || 0;
  const liq = cand.pair?.liquidity?.usd || 0;
  const mcBonus = (cand.classification?.isNew && mc > 0 && mc < 200000) ? 200000 / mc : 1;
  return liq * mcBonus;
}

// ─── Pre-check (cheap, no deep API calls) ────────────────────────────────────
async function preCheck(addr) {
  const pair = await getDexPair(addr);
  if (!pair) return null;

  const liq  = pair.liquidity?.usd || 0;
  const vol  = pair.volume?.h24    || 0;
  const ch5m = pair.priceChange?.m5 || 0;

  if (liq < config.bot.minLiquidityUsd)    return null;
  if (vol < 300)                            return null;
  if (ch5m <= config.bot.devNukeThreshold)  return null;

  const cls = classifyToken(pair);
  if (cls.skip) {
    console.log(`⏭ Skip [${pair.baseToken?.symbol || addr.slice(0,8)}]: ${cls.reason}`);
    return null;
  }

  // Store only what we need — saves RAM
  return {
    pair: {
      baseToken:   pair.baseToken,
      pairAddress: pair.pairAddress,
      pairCreatedAt: pair.pairCreatedAt,
      priceUsd:    pair.priceUsd,
      marketCap:   pair.marketCap,
      fdv:         pair.fdv,
      liquidity:   pair.liquidity,
      volume:      pair.volume,
      priceChange: pair.priceChange,
      txns:        pair.txns,
      info:        pair.info,
    },
    classification: cls,
  };
}

// ─── Deep analysis (sequential calls — lower peak RAM than Promise.all) ───────
async function deepAnalyzeAndPost(addr, pair, classification) {
  try {
    const sym = pair?.baseToken?.symbol || addr.slice(0, 8);
    const mc  = pair?.marketCap || pair?.fdv || 0;
    console.log(`🔎 Deep [${classification.isNew ? 'NEW $' + fmt(mc) : 'HYPE'}]: ${sym}`);

    // Sequential to keep RAM usage flat
    const rugcheck    = await getRugCheck(addr);
    const gt          = await getGeckoToken(addr);
    const gtInfo      = await getGeckoInfo(addr);
    const birdeyeData = await getBirdeyeHolders(addr);
    const heliusAsset = await getHeliusAsset(addr);

    // Hard security filter
    const reject = hardReject(pair, rugcheck);
    if (reject) { console.log(`❌ Reject [${sym}]: ${reject}`); return false; }

    // Mint + Freeze both must be clean
    const mintOk   = rugcheck?.token?.mintAuthority   === null || rugcheck?.token?.mintAuthority   === undefined;
    const freezeOk = rugcheck?.token?.freezeAuthority === null || rugcheck?.token?.freezeAuthority === undefined;
    if (!mintOk || !freezeOk) {
      console.log(`❌ Security [${sym}]: Mint=${mintOk?'OK':'ACTIVE'} Freeze=${freezeOk?'OK':'ACTIVE'}`);
      return false;
    }

    // Top-10 holder check
    if (birdeyeData?.items) {
      const nonRay = birdeyeData.items.filter(h => h.address !== RAYDIUM);
      const total  = nonRay.reduce((s, h) => s + (h.uiAmount || 0), 0);
      const top10  = nonRay.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
      const pct10  = total > 0 ? (top10 / total) * 100 : 0;
      if (pct10 > config.bot.maxTop10PctHardReject) {
        console.log(`❌ Holders [${sym}]: top10=${pct10.toFixed(1)}%`);
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
    console.log(`📊 Score: ${scoring.score}/100 ${scoring.emoji} [${sym}]`);

    if (scoring.score < config.bot.minScore) {
      console.log(`⚠️ Score ${scoring.score} < ${config.bot.minScore} — skip`);
      return false;
    }

    // Build & send — ONE message
    const { msg, imageUrl } = buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck);

    if (imageUrl) {
      try {
        await client.sendFile(config.telegram.postChatId, {
          file: imageUrl, caption: msg.slice(0, 1024), parseMode: 'markdown', linkPreview: false,
        });
      } catch { await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true }); }
    } else {
      await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
    }

    // Track — minimal data only
    const currentMc = pair?.marketCap || pair?.fdv || 0;
    const soc   = pair?.info?.socials || [];
    const tgUrl = soc.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url || null;
    const xUrl  = soc.find(s => s.type === 'twitter'  || s.url?.includes('x.com'))?.url || null;

    if (currentMc > 0) {
      pumperTracked.set(addr, { symbol: sym, entryMc: currentMc, notifiedMultiples: new Set(), tgUrl, xUrl });
      leaderboard.set(addr, { symbol: sym, name: pair?.baseToken?.name || sym, entryMc: currentMc, currentMc, multiple: 1, tgUrl, xUrl, postedAt: Date.now() });
      pruneLeaderboard();
    }

    console.log(`🏆 POSTED: ${sym} | MC $${fmt(currentMc)} | Score ${scoring.score}/100`);
    return true;

  } catch (e) {
    console.error(`💥 deepAnalyze [${addr.slice(0,8)}]:`, e.message);
    return false;
  }
}

// ─── Queue processor — runs every 5s but posts max once per hour ──────────────
async function processQueue() {
  if (isPosting || candidatePool.size === 0) return;
  if (Date.now() - lastPostTime < config.bot.postCooldownMs) return;

  isPosting = true;
  try {
    prunePool();
    if (!candidatePool.size) return;

    // Pick best candidate
    const [bestAddr, bestCand] = [...candidatePool.entries()]
      .sort((a, b) => candidatePriority(b[1]) - candidatePriority(a[1]))[0];

    candidatePool.delete(bestAddr);
    if (postedTokens.has(bestAddr)) return;

    const freshPair = await getDexPair(bestAddr) || bestCand.pair;
    const freshCls  = classifyToken(freshPair);
    if (freshCls.skip) { console.log(`⏭ Re-check skip: ${freshCls.reason}`); return; }

    const posted = await deepAnalyzeAndPost(bestAddr, freshPair, freshCls);
    if (posted) { postedTokens.add(bestAddr); lastPostTime = Date.now(); }
  } finally {
    isPosting = false;
  }
}

// ─── Pumper tracker ───────────────────────────────────────────────────────────
async function checkPumpers() {
  if (!pumperTracked.size) return;
  for (const [addr, info] of pumperTracked) {
    try {
      const pair      = await getDexPair(addr);
      if (!pair) continue;
      const currentMc = pair.marketCap || pair.fdv || 0;
      if (!currentMc || !info.entryMc) continue;
      const multiple  = Math.floor(currentMc / info.entryMc);
      const lb = leaderboard.get(addr);
      if (lb) { lb.currentMc = currentMc; lb.multiple = multiple; }
      for (const t of config.bot.pumperMultiples) {
        if (multiple >= t && !info.notifiedMultiples.has(t)) {
          info.notifiedMultiples.add(t);
          const msg = buildPumperUpdate(info.symbol, addr, info.entryMc, currentMc, t);
          await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
          console.log(`🚀 ${info.symbol} ${t}X!`);
          await sleep(3000);
        }
      }
    } catch (e) { console.error(`Pumper [${addr.slice(0,8)}]:`, e.message); }
  }
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
async function postLeaderboard() {
  const entries = [...leaderboard.values()].filter(e => e.multiple >= 2);
  if (!entries.length) return;
  const msg = buildLeaderboard(entries, config.bot.leaderboardSize);
  if (!msg) return;
  try {
    await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
    console.log(`📊 Leaderboard posted (${entries.length} entries)`);
  } catch (e) { console.error('Leaderboard:', e.message); }
}

// ─── Fallback pollers — every 3 min, uses minimal RAM ────────────────────────
async function pollFallbacks() {
  try {
    // Sequential — not Promise.all — to keep peak RAM low
    const profiles = await getDexLatestProfiles();
    const boosts   = await getDexLatestBoosts();
    const tokens   = [...profiles, ...boosts];
    let found = 0;
    for (const t of tokens) {
      if (candidatePool.size >= config.bot.maxPoolSize) break;  // pool full
      const addr = t.tokenAddress;
      if (!addr || postedTokens.has(addr) || candidatePool.has(addr)) continue;
      const result = await preCheck(addr);
      if (result) { candidatePool.set(addr, { ...result, addedAt: Date.now() }); found++; }
    }
    if (found) console.log(`🔄 Fallback: +${found} candidates (pool: ${candidatePool.size})`);
  } catch (e) { console.error('Fallback:', e.message); }
}

// ─── Telegram handler ─────────────────────────────────────────────────────────
async function handleMessage(event) {
  try {
    if (event.message.out) return;
    const text = event.message.message || '';
    if (!text) return;
    for (const addr of extractAddresses(text)) {
      if (postedTokens.has(addr) || candidatePool.has(addr)) continue;
      if (candidatePool.size >= config.bot.maxPoolSize) break;
      const result = await preCheck(addr);
      if (result) {
        candidatePool.set(addr, { ...result, addedAt: Date.now() });
        console.log(`📥 [${result.classification.isNew ? 'NEW' : 'HYPE'}]: ${result.pair?.baseToken?.symbol || addr.slice(0,8)}`);
      }
    }
  } catch (e) { console.error('handleMsg:', e.message); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════╗');
  console.log('║  🕵️  RUG ANALYZER PRO v3.2  ║');
  console.log('║  Lean • Safe • 1h Best Call  ║');
  console.log('╚══════════════════════════════╝');
  console.log('');

  await client.connect();
  const me = await client.getMe();
  console.log(`🚀 Logged in: @${me.username || me.firstName}`);
  console.log(`📡 Source : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`📤 Post   : ${config.telegram.postChatId}`);
  console.log(`🎯 Score  : ${config.bot.minScore}/100 min | Cooldown: 1h`);
  console.log('');

  const filter = config.telegram.sourceChatIds.length ? { chats: config.telegram.sourceChatIds } : {};
  client.addEventHandler(handleMessage, new NewMessage(filter));

  setInterval(processQueue,    5000);
  setInterval(checkPumpers,    config.bot.pumperCheckMs);
  setInterval(postLeaderboard, config.bot.leaderboardIntervalMs);
  setInterval(pollFallbacks,   3 * 60 * 1000);

  await pollFallbacks();

  console.log('✅ Bot live — best call every hour!');
  setInterval(() => {}, 60000);
}

main().catch(e => { console.error('💥 FATAL:', e.message); process.exit(1); });
