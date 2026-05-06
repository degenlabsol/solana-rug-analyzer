'use strict';
/**
 * Rug Analyzer PRO — Telegram Session Generator
 * Run this ONCE to get your session string.
 * Then paste the output into .env as TELEGRAM_SESSION
 *
 * Usage:
 *   node generate-session.js
 */

require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline = require('readline');

const apiId   = parseInt(process.env.TELEGRAM_API_ID   || '0');
const apiHash = (process.env.TELEGRAM_API_HASH         || '').trim();

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

async function main() {
  console.log('');
  console.log('=== Rug Analyzer PRO — Session Generator ===');
  console.log('Get your API credentials at: https://my.telegram.org/apps');
  console.log('');

  const id   = apiId   || parseInt((await ask('Enter your API ID   : ')).trim());
  const hash = apiHash || (await ask('Enter your API Hash : ')).trim();

  const client = new TelegramClient(new StringSession(''), id, hash, {
    connectionRetries: 3,
  });

  await client.start({
    phoneNumber: async () => (await ask('Phone number (e.g. +14155552671): ')).trim(),
    password:    async () => (await ask('2FA password (press Enter if none): ')).trim(),
    phoneCode:   async () => (await ask('Telegram verification code        : ')).trim(),
    onError: e  => console.error('[ERROR]', e.message),
  });

  const session = client.session.save();
  rl.close();

  console.log('');
  console.log('===========================================');
  console.log('  SUCCESS! Copy the string below and');
  console.log('  add it to your .env file:');
  console.log('');
  console.log('  TELEGRAM_SESSION=' + session);
  console.log('');
  console.log('===========================================');
  console.log('');

  await client.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  rl.close();
  process.exit(1);
});
