'use strict';

require('dotenv').config();

const config = {
  telegram: {
    apiId:   parseInt(process.env.TELEGRAM_API_ID || '0'),
    apiHash: process.env.TELEGRAM_API_HASH        || '',
    session: process.env.SESSION_SECRET           ||
             process.env.TELEGRAM_SESSION         || '',
    postChatId:    process.env.POST_CHAT_ID       || '',
    sourceChatIds: (process.env.SOURCE_CHAT_IDS || 'solearlytrending,degenlabsolgroup')
      .split(',').map(s => s.trim()).filter(Boolean),
  },
  api: {
    heliusKey:  process.env.HELIUS_API_KEY || '',
    birdeyeKey: process.env.BIRDEYE_API    || process.env.BIRDEYE_API_KEY || '',
  },
  bot: {
    // ── Quality gates ─────────────────────────────────────────────
    minScore:              parseInt(process.env.MIN_SCORE           || '58'),
    minLiquidityUsd:       parseInt(process.env.MIN_LIQUIDITY_USD   || '8000'),
    maxTop10PctHardReject: parseInt(process.env.MAX_TOP10_PCT       || '45'),
    devNukeThreshold:      parseInt(process.env.DEV_NUKE_THRESHOLD  || '-60'),

    // ── New token (< 3h old) ──────────────────────────────────────
    newTokenMaxMc:    parseInt(process.env.NEW_TOKEN_MAX_MC  || '800000'),
    newTokenMinMc:    parseInt(process.env.NEW_TOKEN_MIN_MC  || '15000'),
    newTokenMaxAgeMs: parseInt(process.env.NEW_TOKEN_MAX_AGE_H || '3') * 60 * 60 * 1000,

    // ── Old token: needs 5m spike ─────────────────────────────────
    oldTokenMin5mPct: parseFloat(process.env.OLD_TOKEN_MIN_5M_PCT || '12'),
    oldTokenMinLiqUsd:parseInt(process.env.OLD_TOKEN_MIN_LIQ      || '30000'),

    // ── Timing (lean — one post per hour) ────────────────────────
    postCooldownMs:   parseInt(process.env.POST_COOLDOWN_MS || '3600000'),  // 1 hour
    poolTtlMs:        parseInt(process.env.POOL_TTL_MS      || String(60 * 60 * 1000)), // 1h TTL
    pumperCheckMs:    parseInt(process.env.PUMPER_CHECK_MS  || String(20 * 60 * 1000)), // 20min
    fetchTimeoutMs:   parseInt(process.env.FETCH_TIMEOUT_MS || '12000'),
    fetchRetries:     parseInt(process.env.FETCH_RETRIES    || '2'),
    dexRateLimitMs:   parseInt(process.env.DEX_RATE_LIMIT_MS|| '3000'),

    // ── Memory limits (keep RAM low on phone) ────────────────────
    maxPoolSize:      parseInt(process.env.MAX_POOL_SIZE     || '15'),
    maxLeaderboard:   parseInt(process.env.MAX_LEADERBOARD   || '20'),
    leaderboardSize:  parseInt(process.env.LEADERBOARD_SIZE  || '10'),

    // ── Leaderboard post interval ─────────────────────────────────
    leaderboardIntervalMs: parseInt(process.env.LEADERBOARD_INTERVAL_MS || String(8 * 60 * 60 * 1000)),

    // ── Pumper multiples ──────────────────────────────────────────
    pumperMultiples: (process.env.PUMPER_MULTIPLES || '2,3,5,10')
      .split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b),
  },
};

function validate() {
  const errors = [];
  if (!config.telegram.apiId || !config.telegram.apiHash)
    errors.push('TELEGRAM_API_ID and TELEGRAM_API_HASH are required');
  if (!config.telegram.postChatId)
    errors.push('POST_CHAT_ID is required');
  if (!config.telegram.session)
    errors.push('SESSION_SECRET (or TELEGRAM_SESSION) is missing');

  if (errors.length) { errors.forEach(e => console.error('❌ ' + e)); process.exit(1); }

  console.log('✅ Config loaded');
  console.log(`   Source : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`   Post   : ${config.telegram.postChatId}`);
  console.log(`   Score  : ${config.bot.minScore}/100 min`);
  console.log(`   Helius : ${config.api.heliusKey  ? '✅' : '❌ optional'}`);
  console.log(`   Birdeye: ${config.api.birdeyeKey ? '✅' : '❌ optional'}`);
}

module.exports = { config, validate };
