'use strict';

require('dotenv').config();

const config = {
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    session: process.env.TELEGRAM_SESSION || '',
    postChatId: process.env.POST_CHAT_ID || '',
    sourceChatIds: (process.env.SOURCE_CHAT_IDS || 'solearlytrending,degenlabsolgroup')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },
  api: {
    heliusKey: process.env.HELIUS_API_KEY || '',
    birdeyeKey: process.env.BIRDEYE_API_KEY || '',
  },
  bot: {
    postCooldownMs: 28000,
    poolTtlMs: 18 * 60 * 1000,
    pumperCheckMs: 12 * 60 * 1000,
    fetchTimeoutMs: 10000,
    fetchRetries: 3,
    minLiquidityUsd: 10000,
    maxTop10PctHardReject: 55,
    devNukeThreshold: -65,
    pumperMultiples: [2, 3, 4, 5, 10],
  },
};

function validate() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    console.error('❌ TELEGRAM_API_ID und TELEGRAM_API_HASH fehlen!');
    process.exit(1);
  }
  if (!config.telegram.postChatId) {
    console.error('❌ POST_CHAT_ID fehlt! Wohin soll der Bot posten?');
    process.exit(1);
  }
  if (!config.telegram.session) {
    console.warn('⚠️  TELEGRAM_SESSION fehlt — Bot kann sich nicht anmelden.');
  }
  console.log('✅ Config geladen');
  console.log(`   Source Chats: ${config.telegram.sourceChatIds.join(', ')}`);
  console.log(`   Post Chat: ${config.telegram.postChatId}`);
  console.log(`   Helius: ${config.api.heliusKey ? '✅' : '❌ (optional)'}`);
  console.log(`   Birdeye: ${config.api.birdeyeKey ? '✅' : '❌ (optional)'}`);
}

module.exports = { config, validate };
