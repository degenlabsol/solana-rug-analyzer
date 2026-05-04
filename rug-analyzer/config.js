'use strict';

require('dotenv').config();

const config = {
  telegram: {
    apiId:        parseInt(process.env.TELEGRAM_API_ID   || '0'),
    apiHash:      process.env.TELEGRAM_API_HASH          || '',
    session:      process.env.TELEGRAM_SESSION           || '',
    postChatId:   process.env.POST_CHAT_ID               || '',
    sourceChatIds: (process.env.SOURCE_CHAT_IDS || 'solearlytrending,degenlabsolgroup')
      .split(',').map(s => s.trim()).filter(Boolean),
  },
  api: {
    heliusKey:      process.env.HELIUS_API_KEY      || '',
    birdeyeKey:     process.env.BIRDEYE_API_KEY     || '',
    openRouterKey:  process.env.OPENROUTER_API_KEY  || '',
    openRouterModel: process.env.OPENROUTER_MODEL   || 'mistralai/mistral-7b-instruct:free',
  },
  bot: {
    postCooldownMs:       parseInt(process.env.POST_COOLDOWN_MS       || '28000'),
    poolTtlMs:            parseInt(process.env.POOL_TTL_MS            || String(18 * 60 * 1000)),
    pumperCheckMs:        parseInt(process.env.PUMPER_CHECK_MS        || String(12 * 60 * 1000)),
    leaderboardIntervalMs: parseInt(process.env.LEADERBOARD_INTERVAL_MS || String(6 * 60 * 60 * 1000)),
    marketUpdateIntervalMs: parseInt(process.env.MARKET_UPDATE_INTERVAL_MS || String(24 * 60 * 60 * 1000)),
    fetchTimeoutMs:       parseInt(process.env.FETCH_TIMEOUT_MS       || '10000'),
    fetchRetries:         parseInt(process.env.FETCH_RETRIES          || '3'),
    minLiquidityUsd:      parseInt(process.env.MIN_LIQUIDITY_USD      || '10000'),
    maxTop10PctHardReject: parseInt(process.env.MAX_TOP10_PCT          || '55'),
    devNukeThreshold:     parseInt(process.env.DEV_NUKE_THRESHOLD     || '-65'),
    minScore:             parseInt(process.env.MIN_SCORE              || '30'),
    pumperMultiples:      (process.env.PUMPER_MULTIPLES || '2,3,4,5,10')
      .split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b),
    leaderboardSize:      parseInt(process.env.LEADERBOARD_SIZE       || '12'),
    dexRateLimitMs:       parseInt(process.env.DEX_RATE_LIMIT_MS      || '2000'),
  },
};

function validate() {
  const errors = [];
  if (!config.telegram.apiId || !config.telegram.apiHash) errors.push('TELEGRAM_API_ID and TELEGRAM_API_HASH are required');
  if (!config.telegram.postChatId) errors.push('POST_CHAT_ID is required');
  if (!config.telegram.session)    errors.push('TELEGRAM_SESSION is missing — bot cannot log in');

  if (errors.length) {
    errors.forEach(e => console.error(`❌  ${e}`));
    process.exit(1);
  }

  console.log('✅  Config loaded');
  console.log(`    Source chats : ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`    Post channel : ${config.telegram.postChatId}`);
  console.log(`    Helius       : ${config.api.heliusKey      ? '✅' : '❌ (optional)'}`);
  console.log(`    Birdeye      : ${config.api.birdeyeKey     ? '✅' : '❌ (optional)'}`);
  console.log(`    OpenRouter   : ${config.api.openRouterKey  ? '✅' : '❌ (optional — daily market update)'}`);
}

module.exports = { config, validate };
