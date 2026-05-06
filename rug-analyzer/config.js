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
    heliusKey:       process.env.HELIUS_API_KEY    || '',
    birdeyeKey:      process.env.BIRDEYE_API       || process.env.BIRDEYE_API_KEY || '',
    openRouterKey:   process.env.OPENROUTER_KEY    || process.env.OPENROUTER_API_KEY || '',
    openRouterModel: process.env.OPENROUTER_MODEL  || 'mistralai/mistral-7b-instruct:free',
    solanaTrackerKey:process.env.SOLANATRACKERIO_KEY || '',
    alchemyKey:      process.env.ALCHEMY_KEY       || '',
    jupiterKey:      process.env.JUPITER_KEY       || '',
    svsKey:          process.env.SVS_API_KEY       || '',
  },
  bot: {
    // ── Posting quality gates ────────────────────────────────────
    // Minimum score to post a call (0-100). Raise this for safer calls.
    minScore:              parseInt(process.env.MIN_SCORE              || '58'),

    // Minimum liquidity in USD
    minLiquidityUsd:       parseInt(process.env.MIN_LIQUIDITY_USD      || '8000'),

    // Hard-reject if top-10 holders own more than this %
    maxTop10PctHardReject: parseInt(process.env.MAX_TOP10_PCT          || '45'),

    // Hard-reject if price dropped more than this % (dev nuke)
    devNukeThreshold:      parseInt(process.env.DEV_NUKE_THRESHOLD     || '-60'),

    // ── New token rules (token age < NEW_TOKEN_MAX_AGE_H hours) ──
    // Max market cap (USD) to still count as an "early" opportunity
    newTokenMaxMc:         parseInt(process.env.NEW_TOKEN_MAX_MC       || '800000'),
    // Min MC to avoid dust / honeypot traps
    newTokenMinMc:         parseInt(process.env.NEW_TOKEN_MIN_MC       || '15000'),
    // Max age in milliseconds to be considered a NEW token (default 3h)
    newTokenMaxAgeMs:      parseInt(process.env.NEW_TOKEN_MAX_AGE_H    || '3') * 60 * 60 * 1000,

    // ── Old token rules (token age >= NEW_TOKEN_MAX_AGE_H hours) ─
    // Only accept old tokens if 5-min price change is >= this % (sudden hype)
    oldTokenMin5mPct:      parseFloat(process.env.OLD_TOKEN_MIN_5M_PCT || '12'),
    // And minimum liquidity must be higher (already established token)
    oldTokenMinLiqUsd:     parseInt(process.env.OLD_TOKEN_MIN_LIQ      || '30000'),

    // ── Timing ────────────────────────────────────────────────────
    postCooldownMs:        parseInt(process.env.POST_COOLDOWN_MS       || '3600000'),
    poolTtlMs:             parseInt(process.env.POOL_TTL_MS            || String(18 * 60 * 1000)),
    pumperCheckMs:         parseInt(process.env.PUMPER_CHECK_MS        || String(12 * 60 * 1000)),
    leaderboardIntervalMs: parseInt(process.env.LEADERBOARD_INTERVAL_MS|| String(6 * 60 * 60 * 1000)),
    marketUpdateIntervalMs:parseInt(process.env.MARKET_UPDATE_INTERVAL_MS|| String(24 * 60 * 60 * 1000)),
    fetchTimeoutMs:        parseInt(process.env.FETCH_TIMEOUT_MS       || '10000'),
    fetchRetries:          parseInt(process.env.FETCH_RETRIES          || '3'),
    dexRateLimitMs:        parseInt(process.env.DEX_RATE_LIMIT_MS      || '2000'),

    // ── Pumper & leaderboard ─────────────────────────────────────
    pumperMultiples:       (process.env.PUMPER_MULTIPLES || '2,3,4,5,10')
      .split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b),
    leaderboardSize:       parseInt(process.env.LEADERBOARD_SIZE       || '12'),
  },
};

function validate() {
  const errors = [];
  if (!config.telegram.apiId || !config.telegram.apiHash)
    errors.push('TELEGRAM_API_ID and TELEGRAM_API_HASH are required');
  if (!config.telegram.postChatId)
    errors.push('POST_CHAT_ID is required');
  if (!config.telegram.session)
    errors.push('SESSION_SECRET (or TELEGRAM_SESSION) is missing — cannot log in');

  if (errors.length) {
    errors.forEach(e => console.error(`❌  ${e}`));
    process.exit(1);
  }

  console.log('✅  Config loaded');
  console.log(`    Source chats   : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`    Post channel   : ${config.telegram.postChatId}`);
  console.log(`    Min score      : ${config.bot.minScore}/100`);
  console.log(`    New token MC   : $${config.bot.newTokenMinMc.toLocaleString()} – $${config.bot.newTokenMaxMc.toLocaleString()}`);
  console.log(`    Old token 5m   : +${config.bot.oldTokenMin5mPct}% hype required`);
  console.log(`    Helius         : ${config.api.heliusKey        ? '✅' : '❌ (optional)'}`);
  console.log(`    Birdeye        : ${config.api.birdeyeKey       ? '✅' : '❌ (optional)'}`);
  console.log(`    OpenRouter     : ${config.api.openRouterKey    ? '✅' : '❌ (optional)'}`);
  console.log(`    SolanaTracker  : ${config.api.solanaTrackerKey ? '✅' : '❌ (optional)'}`);
  console.log(`    Alchemy RPC    : ${config.api.alchemyKey       ? '✅' : '❌ (optional)'}`);
}

module.exports = { config, validate };
