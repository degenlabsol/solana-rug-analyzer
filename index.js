/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input'); // Für die CMD Eingaben

// --- Config ---
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION || '';

const SOURCE_CHAT_IDS = (process.env.SOURCE_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const FORWARD_CHAT_ID = process.env.FORWARD_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const SVS_API_KEY = process.env.SVS_API_KEY || '';

let MIN_FORWARD_SCORE = parseInt(process.env.MIN_FORWARD_SCORE || '60', 10);
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '8000', 10);
const ANALYSIS_TIMEOUT_MS = parseInt(process.env.ANALYSIS_TIMEOUT_MS || '15000', 10);

const STORE_PATH = path.join(__dirname, 'analyzed.json');
const STORE_MAX = 5000;
const REANALYZE_AFTER_MS = 6 * 60 * 60 * 1000;

if (!API_ID || !API_HASH) {
  console.error('[boot] FATAL: TELEGRAM_API_ID oder TELEGRAM_API_HASH fehlt in .env');
  process.exit(1);
}

// --- Speicher Logik ---
let store = { tokens: {} };
function loadStore() { /* ... wie bisher ... */ }
function saveStore() { /* ... wie bisher ... */ }

// --- Extraktion & API Logik ---
// (Füge hier exakt die gleichen Hilfsfunktionen, extractTokenAddresses, heliusRpc, dsTokenPairs etc. aus deinem alten Code ein)
// ... [HIER KOMMT DEIN ANALYSE CODE VON VORHIN REIN (analyzeToken, formatMessage, etc.)] ...

// HINWEIS: Da der Text extrem lang wäre, kopiere einfach die ganze Logik von `const stats = ...` bis runter zu `function formatMessage(a) { ... }` aus der vorherigen Version hier rein. Das ist 1:1 identisch.

// ===========================================================================
// NEU: TELEGRAM USERBOT LOGIN (GramJS)
// ===========================================================================

const stringSession = new StringSession(SESSION_STRING);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let lastForwardAt = 0;
const inflight = new Set();

async function sendAnalysisTo(targetChat, analysis) {
  const caption = formatMessage(analysis); // Deine formatMessage Funktion
  
  try {
    if (analysis.imageUrl) {
      await client.sendFile(targetChat, {
        file: analysis.imageUrl,
        caption: caption,
        parseMode: 'markdown'
      });
    } else {
      await client.sendMessage(targetChat, {
        message: caption,
        parseMode: 'markdown'
      });
    }
  } catch (e) {
    console.error('[send] Fehler beim Senden:', e.message);
  }
}

async function processAddress(address) {
  if (inflight.has(address)) return;
  inflight.add(address);
  try {
    const cached = store.tokens[address];
    if (cached && (Date.now() - cached.ts < REANALYZE_AFTER_MS)) return;

    let analysis = await analyzeToken(address); // Deine alte analyzeToken Funktion
    
    store.tokens[address] = { ts: Date.now(), score: analysis.score };
    saveStore();

    if (analysis.score >= MIN_FORWARD_SCORE) {
      const wait = Math.max(0, lastForwardAt + RATE_LIMIT_MS - Date.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      
      await sendAnalysisTo(FORWARD_CHAT_ID, analysis);
      lastForwardAt = Date.now();
      console.log(`[fwd] → Erfolgreich weitergeleitet (Score: ${analysis.score})`);
    } else {
      console.log(`[block] Score ${analysis.score} zu niedrig.`);
    }
  } catch (e) {
    console.warn('[analyze] Fehler:', e.message);
  } finally {
    inflight.delete(address);
  }
}

// Event-Listener für neue Nachrichten
client.addEventHandler(async (event) => {
  const message = event.message;
  // GramJS Chat-IDs parsen
  const chatId = message.chatId ? message.chatId.toString() : '';
  const senderId = message.senderId ? message.senderId.toString() : '';
  const chatUsername = message.chat && message.chat.username ? message.chat.username : '';

  const text = message.text || '';
  
  // Prüfen, ob die Nachricht aus einer Source-Gruppe kommt
  const isSource = SOURCE_CHAT_IDS.includes(chatId) || 
                   SOURCE_CHAT_IDS.includes(senderId) || 
                   SOURCE_CHAT_IDS.includes('@' + chatUsername);

  if (!isSource) return;

  const addrs = extractTokenAddresses(text); // Deine alte extract-Funktion
  if (!addrs.length) return;
  
  console.log(`[recv] ${addrs.length} Token gefunden.`);
  for (const a of addrs) {
    processAddress(a).catch(e => console.warn(e.message));
  }
}, new NewMessage({}));

// --- Login & Start ---
(async () => {
  console.log('[boot] Starte Telegram Userbot Login...');
  await client.start({
    phoneNumber: async () => await input.text('Bitte Handynummer eingeben (mit Ländercode, z.B. +49170...): '),
    password: async () => await input.text('Bitte 2FA Passwort eingeben (falls vorhanden): '),
    phoneCode: async () => await input.text('Bitte den Telegram-Code eingeben: '),
    onError: (err) => console.log(err),
  });
  
  console.log('\n✅ Erfolgreich als User eingeloggt!');
  const newSession = client.session.save();
  if (!SESSION_STRING) {
    console.log('\n======================================================');
    console.log('WICHTIG: Kopiere diesen String und trage ihn in die .env unter TELEGRAM_SESSION ein:');
    console.log(newSession);
    console.log('======================================================\n');
  }
  
  console.log(`[boot] Bot läuft und hört auf Chats: ${SOURCE_CHAT_IDS.join(', ')}`);
})();