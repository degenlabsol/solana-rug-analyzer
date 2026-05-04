'use strict';

/**
 * ============================================================
 * TELEGRAM SESSION GENERATOR
 * ============================================================
 * Einmalig ausführen: node rug-analyzer/generate-session.js
 * Den ausgegebenen Session-String dann als TELEGRAM_SESSION
 * in die Replit Secrets eintragen.
 * ============================================================
 */

const { TelegramClient } = require('./node_modules/telegram');
const { StringSession }  = require('./node_modules/telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));

(async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Telegram Session Generator             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  const apiId   = parseInt(await ask('API ID (von my.telegram.org): '));
  const apiHash = (await ask('API Hash: ')).trim();
  const phone   = (await ask('Telefonnummer (mit +49...): ')).trim();

  const client = new TelegramClient(
    new StringSession(''),
    apiId,
    apiHash,
    { connectionRetries: 3 }
  );

  await client.start({
    phoneNumber:  () => Promise.resolve(phone),
    phoneCode:    () => ask('Bestätigungscode (aus Telegram): '),
    password:     () => ask('2FA Passwort (falls aktiv, sonst Enter): '),
    onError: (err) => console.error('Fehler:', err.message),
  });

  const session = client.session.save();
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('✅ SESSION STRING (in Replit Secrets eintragen):');
  console.log('');
  console.log(session);
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('Schlüssel: TELEGRAM_SESSION');
  console.log('Wert:      (der String oben)');

  rl.close();
  process.exit(0);
})().catch(e => {
  console.error('Fehler:', e.message);
  process.exit(1);
});
