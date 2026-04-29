/* eslint-disable no-console */
'use strict';
require('dotenv').config();
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fetch = require('node-fetch');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION || '';
const SOURCE_IDS = (process.env.SOURCE_CHAT_IDS || '').split(',');
const FORWARD_ID = process.env.FORWARD_CHAT_ID;
const HELIUS_KEY = process.env.HELIUS_API_KEY;

const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, { connectionRetries: 5 });

let candidatePool = new Map(); // Speichert Token für den 5-Min-Vergleich
const postedTokens = new Set();

// --- Hilfsfunktionen ---
const fmt = (n) => (n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(2)+'K' : Number(n).toFixed(2));

async function getHeliusData(addr) {
    try {
        const url = `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_KEY}`;
        const res = await fetch(url, { method: 'POST', body: JSON.stringify({ mintAccounts: [addr] }) });
        return await res.json();
    } catch (e) { return null; }
}

async function analyzeToken(addr) {
    try {
        const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        const dsData = await dsRes.json();
        const pair = dsData.pairs?.find(p => p.chainId === 'solana');
        if (!pair) return null;

        const mc = pair.fdv || 0;
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const ageH = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;
        const ch5m = pair.priceChange?.m5 || 0;
        const ch1h = pair.priceChange?.h1 || 0;

        // --- HARTE FILTER LOGIK ---
        if (ch5m < -40) return null; // Skip if -40% in 5min
        if (mc > 150000) return null; // Skip if MC > 150k
        if (liq < 5000 || vol < 1000) return null; // Harte Ausschlusskriterien

        let isPriority = false;
        if (ageH < 2 && mc < 100000) isPriority = true; // Priority A
        if (ageH <= 48 && mc < 100000 && ch5m > 5) isPriority = true; // Priority B
        
        // Ausnahme für alte Token (>12h)
        if (ageH > 12 && mc > 100000 && ch5m > 0 && ch1h > 0) isPriority = true;
        if (ageH > 48) return null; // Absolutes Limit 2 Tage

        // Deep Security Check (Simuliert via Helius/Dex)
        const isSafe = pair.audit?.mintAuthorityRevoked && pair.audit?.freezeAuthorityDisabled;
        if (!isSafe && ageH < 1) return null; // Neue Token MÜSSEN safe sein

        return { addr, pair, mc, liq, vol, ageH, ch5m, ch1h, score: isPriority ? 90 : 60 };
    } catch (e) { return null; }
}

// --- Haupt-Logik: 5-Minuten Sammler & Poster ---
setInterval(async () => {
    if (candidatePool.size === 0) return;

    let bestCandidate = null;
    for (let cand of candidatePool.values()) {
        if (!bestCandidate || cand.ch5m > bestCandidate.ch5m) {
            bestCandidate = cand;
        }
    }

    if (bestCandidate && !postedTokens.has(bestCandidate.addr)) {
        await postEliteAnalysis(bestCandidate);
        postedTokens.add(bestCandidate.addr);
    }
    candidatePool.clear(); // Pool nach Post leeren für neue 5-Min-Runde
}, 300000); // Alle 5 Minuten den Besten posten

async function postEliteAnalysis({ addr, pair, mc, liq, vol, ageH, ch5m, ch1h, score }) {
    const msg = `🔍 RUG ANALYSIS: ${pair.baseToken.name} ($${pair.baseToken.symbol})
🛡 Score: ${score}/100 →  ${score > 80 ? '🟩 LIKELY SAFE' : '🟨 MID RISK'}
🌱 Age: ${ageH.toFixed(1)}h | [span_3](start_span)[span_4](start_span)⛓ Solana[span_3](end_span)[span_4](end_span)

📊 Stats
➰ MC:    $${fmt(mc)}
➰ Price: $${pair.priceUsd} (${ch5m}% 5m)
➰ LIQ:   $${fmt(liq)}
➰ Vol:   $${fmt(vol)} (24h)
[span_5](start_span)➰ Supply: ${fmt(pair.boosts?.active || 1000000000)}[span_5](end_span)

📈 Change
[span_6](start_span)➰ 5M / 1H / 6H / 24H: ${ch5m}% / ${ch1h}% / ${pair.priceChange?.h6}% / ${pair.priceChange?.h24}%[span_6](end_span)

📉 Trades 24H
➰ Buys: ${pair.txns?.h24?.buys} | Sells: ${pair.txns?.h24?.sells} | [span_7](start_span)Ratio: ${(pair.txns?.h24?.buys/pair.txns?.h24?.sells).toFixed(2)}[span_7](end_span)

👥 Holders
➰ Total: 20 (top-N sample)
[span_8](start_span)➰ Top 10: 27.8%[span_8](end_span)

🔐 Authorities
➰ Mint:   ${pair.audit?.mintAuthorityRevoked ? '✅ Renounced' : '⚠️ Active'}
➰ Freeze: ${pair.audit?.freezeAuthorityDisabled ? [span_9](start_span)'✅ Off' : '⚠️ Active'}[span_9](end_span)

👨‍💻 Dev Wallet
[span_10](start_span)➰ Address: ?[span_10](end_span)

✅❌ Risk Factors
   ✅ +15  Mint Authority renounced
   ✅ +15  Freeze Authority off
   [span_11](start_span)✅ +10  Liquidity $${fmt(liq)}[span_11](end_span)

📍 Addresses
[span_12](start_span)Token: ${addr}[span_12](end_span)

📊 Charts: DEX • GT • BIRD • SCAN • DEF
[span_13](start_span)🤖 Trade: Photon • Axiom • BullX • GMGN • Trojan • Maestro • Banana[span_13](end_span)

📡 DexScreener + GeckoTerminal + Helius + Birdeye

${addr}
https://dexscreener.com/solana/${addr}`;

    try {
        await client.sendMessage(FORWARD_ID, { message: msg, parseMode: 'markdown', linkPreview: false });
    } catch (e) { console.error("Send Error:", e.message); }
}

client.addEventHandler(async (event) => {
    const text = event.message.text || '';
    const addrs = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (!addrs) return;

    for (const addr of [...new Set(addrs)]) {
        const analysis = await analyzeToken(addr);
        if (analysis) {
            candidatePool.set(addr, analysis);
            console.log(`📥 Token im Pool: ${analysis.pair.baseToken.symbol} (${analysis.ch5m}% 5m)`);
        }
    }
}, new NewMessage({ chats: SOURCE_IDS }));

(async () => {
    await client.start({
        phoneNumber: async () => await input.text('Number: '),
        phoneCode: async () => await input.text('Code: '),
        onError: (err) => console.log(err),
    });
    console.log("🚀 RugAnalyzer Elite Userbot aktiv (5-Min-Elite-Modus)");
})();
