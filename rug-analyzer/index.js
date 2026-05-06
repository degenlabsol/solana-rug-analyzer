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

process.on('uncaughtException',  e => console.error('[CRASH] Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('[CRASH] Unhandled:', e?.message || e));
process.on('SIGINT',  () => { console.log('[BOT] Stopped by user.'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[BOT] SIGTERM received.'); process.exit(0); });

validate();

// ─── State (minimal — keeps RAM low on phone) ─────────────────────────────────
const candidatePool = new Map();  // addr → { pair, classification, addedAt }
const postedTokens  = new Set();
const pumperTracked = new Map();
const leaderboard   = new Map();
let   lastPostTime  = 0;
let   isPosting     = false;

const RAYDIUM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── Telegram client ──────────────────────────────────────────────────────────
function createClient() {
  return new TelegramClient(
    new StringSession(config.telegram.session),
    config.telegram.apiId, config.telegram.apiHash,
    {
      connectionRetries: Infinity,
      retryDelay:        5000,
      autoReconnect:     true,
      floodSleepThreshold: 120,
      deviceModel: 'RugAnalyzerPRO',
      appVersion:  '3.2.0',
      langCode:    'en',
    }
  );
}

let client = createClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isSolAddr = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

function extractAddresses(text) {
  return [...new Set((text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || []))].filter(isSolAddr);
}

function prunePool() {
  const cutoff = Date.now() - config.bot.poolTtlMs;
  for (const [addr, c] of candidatePool)
    if (c.addedAt < cutoff) candidatePool.delete(addr);

  if (candidatePool.size > config.bot.maxPoolSize) {
    const sorted = [...candidatePool.entries()]
      .sort((a, b) => candidatePriority(a[1]) - candidatePriority(b[1]));
    sorted.slice(0, candidatePool.size - config.bot.maxPoolSize)
      .forEach(([a]) => candidatePool.delete(a));
  }
}

function pruneLeaderboard() {
  if (leaderboard.size <= config.bot.maxLeaderboard) return;
  const sorted = [...leaderboard.entries()].sort((a, b) => a[1].postedAt - b[1].postedAt);
  sorted.slice(0, leaderboard.size - config.bot.maxLeaderboard).forEach(([a]) => leaderboard.delete(a));
}

function candidatePriority(cand) {
  const mc  = cand.pair?.marketCap || cand.pair?.fdv || 0;
  const liq = cand.pair?.liquidity?.usd || 0;
  const mcBonus = (cand.classification?.isNew && mc > 0 && mc < 200000) ? 200000 / mc : 1;
  return liq * mcBonus;
}

// ─── Pre-check (cheap — no deep API calls) ────────────────────────────────────
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
    console.log(`[SKIP] ${pair.baseToken?.symbol || addr.slice(0,8)}: ${cls.reason}`);
    return null;
  }

  // Store only essential fields — saves RAM
  return {
    pair: {
      baseToken:    pair.baseToken,
      pairAddress:  pair.pairAddress,
      pairCreatedAt:pair.pairCreatedAt,
      priceUsd:     pair.priceUsd,
      marketCap:    pair.marketCap,
      fdv:          pair.fdv,
      liquidity:    pair.liquidity,
      volume:       pair.volume,
      priceChange:  pair.priceChange,
      txns:         pair.txns,
      info:         pair.info,
    },
    classification: cls,
  };
}

// ─── Deep analysis (sequential calls — lower peak RAM than Promise.all) ────────
async function deepAnalyzeAndPost(addr, pair, classification) {
  try {
    const sym = pair?.baseToken?.symbol || addr.slice(0, 8);
    const mc  = pair?.marketCap || pair?.fdv || 0;
    console.log(`[ANALYZE] ${classification.isNew ? 'NEW $' + fmt(mc) : 'HYPE'}: ${sym}`);

    const rugcheck    = await getRugCheck(addr);
    const gt          = await getGeckoToken(addr);
    const gtInfo      = await getGeckoInfo(addr);
    const birdeyeData = await getBirdeyeHolders(addr);
    const heliusAsset = await getHeliusAsset(addr);

    // Hard security check
    const reject = hardReject(pair, rugcheck);
    if (reject) { console.log(`[REJECT] ${sym}: ${reject}`); return false; }

    const mintOk   = rugcheck?.token?.mintAuthority   == null;
    const freezeOk = rugcheck?.token?.freezeAuthority == null;
    if (!mintOk || !freezeOk) {
      console.log(`[SECURITY] ${sym}: Mint=${mintOk?'OK':'ACTIVE'} Freeze=${freezeOk?'OK':'ACTIVE'}`);
      return false;
    }

    // Top-10 holder check
    if (birdeyeData?.items) {
      const nonRay = birdeyeData.items.filter(h => h.address !== RAYDIUM);
      const total  = nonRay.reduce((s, h) => s + (h.uiAmount || 0), 0);
      const top10  = nonRay.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
      const pct10  = total > 0 ? (top10 / total) * 100 : 0;
      if (pct10 > config.bot.maxTop10PctHardReject) {
        console.log(`[REJECT] ${sym}: top10=${pct10.toFixed(1)}% — too concentrated`);
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
    console.log(`[SCORE] ${sym}: ${scoring.score}/100 ${scoring.emoji}`);

    if (scoring.score < config.bot.minScore) {
      console.log(`[BELOW MIN] ${scoring.score} < ${config.bot.minScore} — skip`);
      return false;
    }

    // Build & send
    const { msg, imageUrl } = buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck);

    if (imageUrl) {
      try {
        await client.sendFile(config.telegram.postChatId, {
          file: imageUrl, caption: msg.slice(0, 1024), parseMode: 'markdown', linkPreview: false,
        });
      } catch {
        await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
      }
    } else {
      await client.sendMessage(config.telegram.postChatId, { message: msg, parseMode: 'markdown', linkPreview: true });
    }

    // Track
    const currentMc = pair?.marketCap || pair?.fdv || 0;
    const soc   = pair?.info?.socials || [];
    const tgUrl = soc.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url || null;
    const xUrl  = soc.find(s => s.type === 'twitter'  || s.url?.includes('x.com'))?.url || null;

    if (currentMc > 0) {
      pumperTracked.set(addr, { symbol: sym, entryMc: currentMc, notifiedMultiples: new Set(), tgUrl, xUrl });
      leaderboard.set(addr, { symbol: sym, name: pair?.baseToken?.name || sym, entryMc: currentMc, currentMc, multiple: 1, tgUrl, xUrl, postedAt: Date.now() });
      pruneLeaderboard();
    }

    console.log(`[POSTED] ${sym} | MC $${fmt(currentMc)} | Score ${scoring.score}/100`);
    return true;

  } catch (e) {
    console.error(`[ERROR] deepAnalyze [${addr.slice(0,8)}]:`, e.message);
    return false;
  }
}

// ─── Queue processor — runs every 5s, posts max once per hour ─────────────────
async function processQueue() {
  if (isPosting || !candidatePool.size) return;
  if (Date.now() - lastPostTime < config.bot.postCooldownMs) return;

  isPosting = true;
  try {
    prunePool();
    if (!candidatePool.size) return;

    const [bestAddr, bestCand] = [...candidatePool.entries()]
      .sort((a, b) => candidatePriority(b[1]) - candidatePriority(a[1]))[0];

    candidatePool.delete(bestAddr);
    if (postedTokens.has(bestAddr)) return;

    const freshPair = await getDexPair(bestAddr) || bestCand.pair;
    const freshCls  = classifyToken(freshPair);
    if (freshCls.skip) { console.log(`[RECHECK SKIP] ${freshCls.reason}`); return; }

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
          console.log(`[PUMPER] ${info.symbol} ${t}X!`);
          await sleep(3000);
        }
      }
    } catch (e) { console.error(`[PUMPER ERROR] ${addr.slice(0,8)}:`, e.message); }
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
    console.log(`[LEADERBOARD] Posted ${entries.length} entries`);
  } catch (e) { console.error('[LEADERBOARD ERROR]', e.message); }
}

// ─── Fallback pollers ─────────────────────────────────────────────────────────
async function pollFallbacks() {
  try {
    const profiles = await getDexLatestProfiles();
    const boosts   = await getDexLatestBoosts();
    const tokens   = [...profiles, ...boosts];
    let found = 0;
    for (const t of tokens) {
      if (candidatePool.size >= config.bot.maxPoolSize) break;
      const addr = t.tokenAddress;
      if (!addr || postedTokens.has(addr) || candidatePool.has(addr)) continue;
      const result = await preCheck(addr);
      if (result) { candidatePool.set(addr, { ...result, addedAt: Date.now() }); found++; }
    }
    if (found) console.log(`[FALLBACK] +${found} candidates (pool: ${candidatePool.size})`);
  } catch (e) { console.error('[FALLBACK ERROR]', e.message); }
}

// ─── Telegram message handler ─────────────────────────────────────────────────
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
        console.log(`[POOL] ${result.classification.isNew ? 'NEW' : 'HYPE'}: ${result.pair?.baseToken?.symbol || addr.slice(0,8)}`);
      }
    }
  } catch (e) { console.error('[MSG ERROR]', e.message); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════╗');
  console.log('║   RUG ANALYZER PRO v3.2 LEAN     ║');
  console.log('║   Safe Gems  •  1h Best Call     ║');
  console.log('╚══════════════════════════════════╝');
  console.log('');

  // Reconnect loop — handles AUTH_KEY_DUPLICATED and other disconnects
  let connected = false;
  while (!connected) {
    try {
      await client.connect();
      connected = true;
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('AUTH_KEY_DUPLICATED')) {
        console.warn('[AUTH] Session duplicated — waiting 15s before retry...');
        await sleep(15000);
        client = createClient();
      } else if (msg.includes('AUTH_KEY_UNREGISTERED')) {
        console.error('[AUTH] Session is invalid. Run: node generate-session.js');
        process.exit(1);
      } else {
        console.warn('[CONNECT] Retrying in 5s...', msg);
        await sleep(5000);
      }
    }
  }

  const me = await client.getMe();
  console.log(`[BOT] Logged in as: @${me.username || me.firstName}`);
  console.log(`[BOT] Source chats: ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`[BOT] Post target : ${config.telegram.postChatId}`);
  console.log(`[BOT] Min score   : ${config.bot.minScore}/100  |  Cooldown: 1h`);
  console.log('');

  const filter = config.telegram.sourceChatIds.length ? { chats: config.telegram.sourceChatIds } : {};
  client.addEventHandler(handleMessage, new NewMessage(filter));

  setInterval(processQueue,    5000);
  setInterval(checkPumpers,    config.bot.pumperCheckMs);
  setInterval(postLeaderboard, config.bot.leaderboardIntervalMs);
  setInterval(pollFallbacks,   3 * 60 * 1000);

  await pollFallbacks();

  console.log('[BOT] Running — best call posted every hour.');
  setInterval(() => {}, 60000);
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
