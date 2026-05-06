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
const { hardReject, calcScore, classifyToken, ageStr, fmt } = require('./analyzer');
const { buildRugPost, buildPumperUpdate, buildLeaderboard, buildMarketUpdate } = require('./message');

process.on('uncaughtException',  e => console.error('⚠️  Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('⚠️  Unhandled:', e?.message || e));
process.on('SIGINT', () => { console.log('👋 Bot stopped.'); process.exit(0); });

validate();

// ─── State ───────────────────────────────────────────────────────────────────
const candidatePool = new Map();  // addr → { addr, pair, addedAt, classification }
const postedTokens  = new Set();
const pumperTracked = new Map();
const leaderboard   = new Map();
let   lastPostTime  = 0;
let   isPosting     = false;

const RAYDIUM_WALLET = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Telegram Client ─────────────────────────────────────────────────────────
const client = new TelegramClient(
  new StringSession(config.telegram.session),
  config.telegram.apiId,
  config.telegram.apiHash,
  { connectionRetries: Infinity, retryDelay: 3000, autoReconnect: true, floodSleepThreshold: 120 }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isSolanaAddr(s) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }

function extractAddresses(text) {
  return [...new Set((text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || []))].filter(isSolanaAddr);
}

function expirePool() {
  const cutoff = Date.now() - config.bot.poolTtlMs;
  for (const [addr, c] of candidatePool) {
    if (c.addedAt < cutoff) { candidatePool.delete(addr); }
  }
}

// ─── Pre-check: classify then basic data quality check ───────────────────────
async function preCheck(addr) {
  const pair = await getDexPair(addr);
  if (!pair) return null;

  const mc    = pair.marketCap || pair.fdv || 0;
  const liq   = pair.liquidity?.usd || 0;
  const vol   = pair.volume?.h24 || 0;
  const ch5m  = pair.priceChange?.m5 || 0;

  // Absolute garbage filters (cheap, no API calls needed)
  if (liq < config.bot.minLiquidityUsd)       return null;
  if (vol < 300)                               return null;
  if (ch5m <= config.bot.devNukeThreshold)     return null;

  // Classify: new early gem vs old token hype spike
  const cls = classifyToken(pair);
  if (cls.skip) {
    console.log(`⏭  Skip [${pair.baseToken?.symbol || addr.slice(0,8)}]: ${cls.reason}`);
    return null;
  }

  return { pair, classification: cls };
}

// ─── Candidate score for queue prioritisation ─────────────────────────────────
function candidatePriority(cand) {
  const mc  = cand.pair?.marketCap || cand.pair?.fdv || 0;
  const liq = cand.pair?.liquidity?.usd || 0;
  // New low-cap tokens get a big priority boost (more potential upside)
  const mcBonus = (cand.classification?.isNew && mc > 0 && mc < 200000) ? 200000 / mc : 1;
  return liq * mcBonus;
}

// ─── Send one Telegram message (photo + text or text with link preview) ───────
async function sendPost(msg, imageUrl) {
  const chatId    = config.telegram.postChatId;
  const parseMode = 'markdown';

  if (imageUrl) {
    try {
      await client.sendFile(chatId, {
        file: imageUrl, caption: msg.slice(0, 1024),
        parseMode, linkPreview: false,
      });
      return;
    } catch { /* fall through to text message */ }
  }
  // Text message — DexScreener link at bottom auto-generates chart preview
  await client.sendMessage(chatId, { message: msg, parseMode, linkPreview: true });
}

// ─── Deep analysis ────────────────────────────────────────────────────────────
async function deepAnalyzeAndPost(addr, pair, classification) {
  try {
    const sym = pair?.baseToken?.symbol || addr.slice(0, 8);
    const mc  = pair?.marketCap || pair?.fdv || 0;
    const tag = classification.isNew ? `NEW $${fmt(mc)} MC` : 'OLD HYPE';
    console.log(`🔎 Deep-Check [${tag}]: ${sym}`);

    const [rugcheck, gt, gtInfo, birdeyeData, heliusAsset] = await Promise.all([
      getRugCheck(addr),
      getGeckoToken(addr),
      getGeckoInfo(addr),
      getBirdeyeHolders(addr),
      getHeliusAsset(addr),
    ]);

    // ── Hard filters ──────────────────────────────────────────────
    const rejectReason = hardReject(pair, rugcheck);
    if (rejectReason) {
      console.log(`❌ Hard-Reject [${sym}]: ${rejectReason}`);
      return false;
    }

    // ── Mint & Freeze must both be clean for a SAFE call ─────────
    const mintOk   = rugcheck?.token?.mintAuthority   === null || rugcheck?.token?.mintAuthority   === undefined;
    const freezeOk = rugcheck?.token?.freezeAuthority === null || rugcheck?.token?.freezeAuthority === undefined;
    if (!mintOk || !freezeOk) {
      console.log(`❌ Security fail [${sym}]: Mint=${mintOk ? 'OK' : 'ACTIVE'} Freeze=${freezeOk ? 'OK' : 'ACTIVE'}`);
      return false;
    }

    // ── Top-10 holder hard reject ─────────────────────────────────
    if (birdeyeData?.items) {
      const nonRay = birdeyeData.items.filter(h => h.address !== RAYDIUM_WALLET);
      const total  = nonRay.reduce((s, h) => s + (h.uiAmount || 0), 0);
      const top10  = nonRay.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
      const pct10  = total > 0 ? (top10 / total) * 100 : 0;
      if (pct10 > config.bot.maxTop10PctHardReject) {
        console.log(`❌ Top-10 too concentrated [${sym}]: ${pct10.toFixed(1)}%`);
        return false;
      }
    }

    // ── Deployer history ─────────────────────────────────────────
    let deployerTxs = null;
    const deployer  = rugcheck?.creator
      || heliusAsset?.authorities?.find(a => a.scopes?.includes('mint'))?.address;
    if (deployer) deployerTxs = await getHeliusDeployerHistory(deployer);

    // ── Score ─────────────────────────────────────────────────────
    const scoring = calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck);
    console.log(`📊 Score: ${scoring.score}/100 → ${scoring.emoji} ${scoring.label} [${sym}] ${tag}`);

    if (scoring.score < config.bot.minScore) {
      console.log(`⚠️  Score ${scoring.score} < ${config.bot.minScore} minimum — skip.`);
      return false;
    }

    // ── Build & send ─────────────────────────────────────────────
    const { msg, imageUrl } = buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck);
    await sendPost(msg, imageUrl);

    // ── Track pumper & leaderboard ───────────────────────────────
    const socLinks = pair?.info?.socials || [];
    const tgUrl    = socLinks.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url || null;
    const xUrl     = socLinks.find(s => s.type === 'twitter'  || s.url?.includes('x.com'))?.url || null;
    const currentMc = pair?.marketCap || pair?.fdv || 0;

    if (currentMc > 0) {
      pumperTracked.set(addr, { symbol: sym, name: pair?.baseToken?.name || sym, entryMc: currentMc, notifiedMultiples: new Set(), tgUrl, xUrl });
      leaderboard.set(addr,   { symbol: sym, name: pair?.baseToken?.name || sym, entryMc: currentMc, currentMc, multiple: 1, tgUrl, xUrl, postedAt: Date.now() });
    }

    console.log(`🏆 POSTED: ${sym} | MC: $${fmt(currentMc)} | Score: ${scoring.score}/100 | ${tag}`);
    return true;

  } catch (e) {
    console.error(`💥 deepAnalyzeAndPost [${addr.slice(0,8)}]:`, e.message);
    return false;
  }
}

// ─── Process queue: pick best candidate ──────────────────────────────────────
async function processQueue() {
  if (isPosting || candidatePool.size === 0) return;
  if (Date.now() - lastPostTime < config.bot.postCooldownMs) return;

  isPosting = true;
  try {
    expirePool();
    if (!candidatePool.size) return;

    // Sort candidates by priority (low-cap new gems first)
    const sorted = [...candidatePool.entries()]
      .sort((a, b) => candidatePriority(b[1]) - candidatePriority(a[1]));

    const [bestAddr, bestCand] = sorted[0];
    candidatePool.delete(bestAddr);
    if (postedTokens.has(bestAddr)) return;

    // Re-fetch fresh data before deep check
    const freshPair = await getDexPair(bestAddr) || bestCand.pair;

    // Re-classify with fresh data
    const freshCls = classifyToken(freshPair);
    if (freshCls.skip) {
      console.log(`⏭  Re-check skip [${freshPair?.baseToken?.symbol || bestAddr.slice(0,8)}]: ${freshCls.reason}`);
      return;
    }

    const posted = await deepAnalyzeAndPost(bestAddr, freshPair, freshCls);
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
      const pair = await getDexPair(addr);
      if (!pair) continue;
      const currentMc = pair.marketCap || pair.fdv || 0;
      if (!currentMc || !info.entryMc) continue;

      const multiple = Math.floor(currentMc / info.entryMc);
      const lb = leaderboard.get(addr);
      if (lb) { lb.currentMc = currentMc; lb.multiple = multiple; }

      for (const target of config.bot.pumperMultiples) {
        if (multiple >= target && !info.notifiedMultiples.has(target)) {
          info.notifiedMultiples.add(target);
          const msg = buildPumperUpdate(info.symbol, addr, info.entryMc, currentMc, target);
          await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
          console.log(`🚀 PUMPER: ${info.symbol} ${target}X!`);
          await sleep(3000);
        }
      }
    } catch (e) { console.error(`Pumper error [${addr.slice(0,8)}]:`, e.message); }
  }
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
async function postLeaderboard() {
  const entries = [...leaderboard.values()].filter(e => e.multiple >= 2);
  if (!entries.length) { console.log('📊 Leaderboard: no 2X+ entries yet.'); return; }
  const msg = buildLeaderboard(entries, config.bot.leaderboardSize);
  if (!msg) return;
  try {
    await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: false });
    console.log(`📊 Leaderboard posted (${entries.length} entries)`);
  } catch (e) { console.error('Leaderboard error:', e.message); }
}

// ─── Daily AI market update ───────────────────────────────────────────────────
async function postMarketUpdate() {
  if (!config.api.openRouterKey) return;
  const topGainers = [...leaderboard.values()]
    .sort((a, b) => b.multiple - a.multiple).slice(0, 5)
    .map(e => ({ symbol: e.symbol, multiple: e.multiple, currentMc: fmt(e.currentMc) }));
  const aiText = await getMarketUpdateFromAI(topGainers, postedTokens.size);
  if (!aiText) { console.log('⚠️  Market update: no AI response'); return; }
  try {
    await client.sendMessage(config.telegram.postChatId, { message: buildMarketUpdate(aiText), parseMode: 'markdown', linkPreview: false });
    console.log('📰 Daily market update posted');
  } catch (e) { console.error('Market update error:', e.message); }
}

// ─── Fallback: add from DexScreener sources ───────────────────────────────────
async function addFromSources(tokens) {
  let found = 0;
  for (const token of tokens) {
    const addr = token.tokenAddress;
    if (!addr || postedTokens.has(addr) || candidatePool.has(addr)) continue;
    const result = await preCheck(addr);
    if (result) { candidatePool.set(addr, { addr, ...result, addedAt: Date.now() }); found++; }
  }
  return found;
}

async function pollFallbacks() {
  try {
    const [profiles, boosts, active] = await Promise.all([
      getDexLatestProfiles(), getDexLatestBoosts(), getDexActiveBoosts(),
    ]);
    const found = await addFromSources([...profiles, ...boosts, ...active]);
    if (found > 0) console.log(`🔄 Fallback: +${found} new candidates (pool: ${candidatePool.size})`);
  } catch (e) { console.error('Fallback error:', e.message); }
}

// ─── Telegram message handler ─────────────────────────────────────────────────
async function handleMessage(event) {
  try {
    if (event.message.out) return;
    const text = event.message.message || '';
    if (!text) return;

    for (const addr of extractAddresses(text)) {
      if (postedTokens.has(addr) || candidatePool.has(addr)) continue;
      const result = await preCheck(addr);
      if (result) {
        candidatePool.set(addr, { addr, ...result, addedAt: Date.now() });
        const sym = result.pair?.baseToken?.symbol || addr.slice(0, 8);
        const mc  = result.pair?.marketCap || result.pair?.fdv || 0;
        const tag = result.classification.isNew ? `NEW $${fmt(mc)}` : 'OLD HYPE';
        console.log(`📥 Candidate [${tag}]: ${sym} | Liq: $${fmt(result.pair?.liquidity?.usd || 0)}`);
      }
    }
  } catch (e) { console.error('handleMessage error:', e.message); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🕵️   RUG ANALYZER PRO — Elite Sniper v3    ║');
  console.log('║  SAFE Low-Cap Hunter • Quality over Quantity  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  await client.connect();
  const me = await client.getMe();
  console.log(`🚀 Logged in as: @${me.username || me.firstName}`);
  console.log(`📡 Monitoring  : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`📤 Posting to  : ${config.telegram.postChatId}`);
  console.log('');

  const filter = config.telegram.sourceChatIds.length ? { chats: config.telegram.sourceChatIds } : {};
  client.addEventHandler(handleMessage, new NewMessage(filter));
  console.log('👂 Telegram listener active');
  console.log(`📋 Strategy    : New tokens $${fmt(config.bot.newTokenMinMc)}–$${fmt(config.bot.newTokenMaxMc)} MC  |  Old tokens +${config.bot.oldTokenMin5mPct}% 5m spike`);
  console.log(`🎯 Min score   : ${config.bot.minScore}/100 (only safe calls posted)`);
  console.log('');

  setInterval(processQueue,     5000);
  setInterval(checkPumpers,     config.bot.pumperCheckMs);
  setInterval(postLeaderboard,  config.bot.leaderboardIntervalMs);
  setInterval(postMarketUpdate, config.bot.marketUpdateIntervalMs);
  setInterval(pollFallbacks,    3 * 60 * 1000);

  await pollFallbacks();  // run immediately

  console.log('✅ Bot is live — SAFE calls only, quality over quantity!');
  console.log('');

  setInterval(() => {}, 60000);  // keep-alive
}

main().catch(e => { console.error('💥 FATAL:', e.message); process.exit(1); });
