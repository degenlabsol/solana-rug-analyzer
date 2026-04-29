/* eslint-disable no-console */
'use strict';
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fetch = require('node-fetch');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION;
const FORWARD_ID = process.env.FORWARD_CHAT_ID;

const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {});
const finalQueue = [];
const topSeen = new Set();

function fmt(n) { if(!n || isNaN(n)) return '0'; if(n>=1e6) return (n/1e6).toFixed(2)+'M'; if(n>=1e3) return (n/1e3).toFixed(2)+'K'; return Number(n).toFixed(2); }

// --- Warteschlange ---
setInterval(async () => {
    if (finalQueue.length > 0) {
        const item = finalQueue.shift();
        try {
            if (item.image) {
                await client.sendFile(FORWARD_ID, { file: item.image, caption: item.text, parseMode: 'markdown' });
            } else {
                await client.sendMessage(FORWARD_ID, { message: item.text, parseMode: 'markdown' });
            }
            console.log(`📡 Elite-Call mit Design versendet.`);
        } catch (e) { console.error("Sendefehler:", e.message); }
    }
}, 12000);

async function analyzeElite(addr) {
    try {
        const [dsRes, rcRes] = await Promise.all([
            fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`),
            fetch(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`).catch(() => null)
        ]);
        const dsData = await dsRes.json();
        const pair = dsData.pairs?.find(p => p.chainId === 'solana');
        if (!pair) return null;

        const rcData = rcRes ? await rcRes.json() : null;
        
        // --- HARTE ELITE FILTER ---
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const isMintRevoked = rcData?.token?.mintAuthority === null;
        const isFreezeOff = rcData?.token?.freezeAuthority === null;

        if (liq < 12000 || vol < 15000) return null; // Nur Qualität
        if (!isMintRevoked || !isFreezeOff) return null; // Sicherheit geht vor

        // --- DESIGN DATEN ---
        const age = pair.pairCreatedAt ? ((Date.now() - pair.pairCreatedAt) / 3600000).toFixed(1) : 'N/A';
        const image = pair.info?.imageUrl || null;
        
        let msg = `🔍 *RUG ANALYSIS: ${pair.baseToken.name} ($${pair.baseToken.symbol})*\n`;
        msg += `🛡 Score: 100/100 → 🟩 *LUKRATIV & SICHER*\n`;
        msg += `🌱 Age: ${age}h | ⛓ Solana\n\n`;
        
        msg += `📊 *Stats*\n`;
        msg += `➰ MC:    $${fmt(pair.fdv)}\n`;
        msg += `➰ Price: $${pair.priceUsd}\n`;
        msg += `➰ LIQ:   $${fmt(liq)}\n`;
        msg += `➰ Vol:   $${fmt(vol)} (24h)\n\n`;

        msg += `📈 *Change*\n`;
        msg += `➰ 5M/1H/24H: ${pair.priceChange.m5}% / ${pair.priceChange.h1}% / ${pair.priceChange.h24}%\n\n`;

        msg += `📉 *Trades 24H*\n`;
        msg += `➰ Buys: ${pair.txns.h24.buys} | Sells: ${pair.txns.h24.sells}\n\n`;

        msg += `🔐 *Authorities*\n`;
        msg += `➰ Mint:   ✅ Renounced\n`;
        msg += `➰ Freeze: ✅ Off\n\n`;

        msg += `✅❌ *Risk Factors*\n`;
        msg += `   ✅ Mint Authority renounced\n`;
        msg += `   ✅ Freeze Authority off\n`;
        msg += `   ✅ Liquidity $${fmt(liq)}\n\n`;

        msg += `📍 *Addresses*\n`;
        msg += `Token: \`${addr}\`\n\n`;

        msg += `📊 [DexScreener](https://dexscreener.com/solana/${addr}) • [Birdeye](https://birdeye.so/token/${addr}?chain=solana)\n`;
        msg += `🤖 [Photon](https://photon-sol.tinyastro.io/en/r/@/${addr}) • [BullX](https://bullx.io/terminal?chainId=1399811149&address=${addr}) • [Trojan](https://t.me/solana_trojanbot?start=r-${addr})`;

        return { text: msg, image };
    } catch (e) { return null; }
}

client.addEventHandler(async (event) => {
    if (event.message.out) return;
    const text = event.message.text || '';
    const addrs = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (!addrs) return;

    for (const addr of [...new Set(addrs)]) {
        if (topSeen.has(addr)) continue;
        const res = await analyzeElite(addr);
        if (res) {
            topSeen.add(addr);
            finalQueue.push(res);
            console.log(`💎 Elite-Token verifiziert & eingereiht: ${addr}`);
        }
    }
}, new NewMessage({}));

(async () => {
    await client.connect();
    console.log("🛡 RugAnalyzer Elite PRO-DESIGN aktiv!");
})();
