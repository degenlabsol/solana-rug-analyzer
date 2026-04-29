/* eslint-disable no-console */
'use strict';
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION || '';
const FORWARD_ID = process.env.FORWARD_CHAT_ID;

const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, { connectionRetries: 5 });

let candidatePool = new Map(); 

// --- Formatting Helpers ---
const fmtNum = (n) => {
    if (!n || isNaN(n)) return '0.00';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return Number(n).toFixed(2);
};
const fmtPct = (n) => (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const shortAddr = (a) => a ? `${a.slice(0, 4)}...${a.slice(-4)}` : '?';

// --- API Fetchers ---
async function fetchDex(addr) {
    try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        const data = await res.json();
        return data.pairs?.find(p => p.chainId === 'solana') || null;
    } catch (e) { return null; }
}

async function fetchRugCheck(addr) {
    try {
        const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) { return null; }
}

// --- Token Pre-Check & Ranking ---
async function preCheckToken(addr) {
    const pair = await fetchDex(addr);
    if (!pair) return null;

    const mc = pair.fdv || pair.marketCap || 0;
    const liq = pair.liquidity?.usd || 0;
    const vol = pair.volume?.h24 || 0;
    const ageH = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;
    const ch5m = pair.priceChange?.m5 || 0;
    const ch1h = pair.priceChange?.h1 || 0;

    // Hard limits
    if (ch5m <= -50) return null; 
    if (liq < 3000 || vol < 2000) return null; 
    
    let rank = 0;
    if (ageH <= 2 && mc < 250000) rank = 3; // Priority A
    else if (ageH <= 48 && mc < 250000 && ch5m > 2) rank = 2; // Priority B
    else if (ageH > 12 && mc > 50000 && ch1h > -10) rank = 1; // Survivors
    else if (mc > 1000000) return null; // Hard skip above 1M MC
    
    if (rank === 0) return null;
    return { addr, pair, mc, liq, vol, ageH, ch5m, ch1h, rank };
}

// --- 10 Minute Cycle ---
setInterval(async () => {
    if (candidatePool.size === 0) return;

    console.log(`⏱ 10-Min-Check: Comparing ${candidatePool.size} tokens... Finding the BEST!`);

    // Sort by rank, then by 5-minute performance
    let candidates = Array.from(candidatePool.values()).sort((a, b) => {
        if (a.rank !== b.rank) return b.rank - a.rank;
        return b.ch5m - a.ch5m;
    });

    let success = false;
    for (let cand of candidates) {
        success = await executeDeepCheckAndPost(cand);
        if (success) break; // Winner found, stop processing
    }

    if (!success) {
        console.log(`❌ 10-Min-Check: Even with soft filters, no viable token was found.`);
    }
    
    candidatePool.clear(); 
    console.log(`🧹 Pool cleared. Collecting for the next 10 minutes...`);
}, 600000); 

// --- Deep Analysis & Post Builder ---
async function executeDeepCheckAndPost(cand) {
    let imagePath = null;
    try {
        const rc = await fetchRugCheck(cand.addr);
        const p = cand.pair;

        // Soft Filter Logic (No hard block for Mint/Freeze)
        const isMintRenounced = rc ? rc.token?.mintAuthority === null : false;
        const isFreezeOff = rc ? rc.token?.freezeAuthority === null : false;

        const supply = rc?.token?.supply || (cand.mc / (Number(p.priceUsd) || 1));
        const buys24 = p.txns?.h24?.buys || 0;
        const sells24 = p.txns?.h24?.sells || 0;
        const ratio = sells24 > 0 ? (buys24 / sells24).toFixed(2) : buys24.toString();
        const totalTrades = buys24 + sells24;

        let top10Pct = 0;
        let topWalletPct = 0;
        let topWalletAddr = '?';
        
        if (rc && rc.topHolders) {
            const top10 = rc.topHolders.slice(0, 10);
            top10Pct = top10.reduce((acc, h) => acc + (h.pct || 0), 0) * 100;
            if (rc.topHolders.length > 0) {
                topWalletPct = (rc.topHolders[0].pct || 0) * 100;
                topWalletAddr = rc.topHolders[0].address;
            }
        }

        // 75% Top Holder Tolerance
        if (top10Pct > 75) return false; 

        // Score Calculation
        let score = 0;
        let risks = [];
        if (isMintRenounced) { score += 15; risks.push(`   ✅ +15  Mint Authority renounced`); }
        else { risks.push(`   ❌  0   Mint Authority ACTIVE (or unverified)`); }
        
        if (isFreezeOff) { score += 15; risks.push(`   ✅ +15  Freeze Authority off`); }
        else { risks.push(`   ❌  0   Freeze Authority ACTIVE (or unverified)`); }
        
        if (cand.liq > 50000) { score += 15; risks.push(`   ✅ +15  Liquidity $${fmtNum(cand.liq)}`); } else { score += 5; risks.push(`   ✅ +5   Liquidity $${fmtNum(cand.liq)}`); }
        if (top10Pct > 0 && top10Pct < 40) { score += 10; risks.push(`   ✅ +10  Top 10 holders ${top10Pct.toFixed(1)}%`); }
        if (cand.vol > 50000) { score += 10; risks.push(`   ✅ +10  Vol24h $${fmtNum(cand.vol)}`); }
        if (totalTrades > 50) { score += 10; risks.push(`   ✅ +10  ${totalTrades} trades`); }
        
        const devAddr = rc?.creator || '?';
        
        // Skip extreme garbage
        if (score < 15) return false;
        
        if (score > 40) score += 30; // Score boost for decent tokens
        const scoreText = score >= 75 ? '🟩 LIKELY SAFE' : (score >= 40 ? '🟨 MID RISK' : '🟥 HIGH RISK');

        // Socials Formatting
        const soc = p.info?.socials || [];
        const tg = soc.find(s => s.type === 'telegram') ? 'TG' : '~TG~';
        const x = soc.find(s => s.type === 'twitter') ? '𝕏' : '~𝕏~';
        const web = p.info?.websites?.length > 0 ? 'Web' : '~Web~';
        const dc = soc.find(s => s.type === 'discord') ? 'DC' : '~DC~';

        // Message Template
        const msg = `🔍 RUG ANALYSIS: ${p.baseToken.name} ($${p.baseToken.symbol})
🛡 Score: ${score}/100 →  ${scoreText}
🌱 Age: ${cand.ageH.toFixed(1)}h | ⛓ Solana

📊 Stats
➰ MC:    $${fmtNum(cand.mc)}
➰ Price: $${p.priceUsd} (${fmtPct(cand.ch5m)} 5m)
➰ LIQ:   $${fmtNum(cand.liq)}
➰ Vol:   $${fmtNum(cand.vol)} (24h)
➰ Supply: ${Number(supply).toLocaleString('en-US', {maximumFractionDigits: 3})}

📈 Change
➰ 5M / 1H / 6H / 24H: ${fmtPct(cand.ch5m)} / ${fmtPct(cand.ch1h)} / ${fmtPct(p.priceChange?.h6||0)} / ${fmtPct(p.priceChange?.h24||0)}

📉 Trades 24H
➰ Buys: ${buys24.toLocaleString()} | Sells: ${sells24.toLocaleString()} | Ratio: ${ratio}

👥 Holders
➰ Total: ${rc?.totalHolders > 0 ? rc.totalHolders : 'N/A'} 
➰ Top 10: ${top10Pct > 0 ? top10Pct.toFixed(1) + '%' : 'N/A'}
➰ Top Wallet: ${topWalletPct > 0 ? topWalletPct.toFixed(1) + '%' : 'N/A'} ${shortAddr(topWalletAddr)}

🔐 Authorities
➰ Mint:   ${isMintRenounced ? '✅ Renounced' : '❌ Active (Danger)'}
➰ Freeze: ${isFreezeOff ? '✅ Off' : '❌ Active (Danger)'}

👨‍💻 Dev Wallet
➰ Address: ${shortAddr(devAddr)}

✅❌ Risk Factors
${risks.join('\n')}

🔗 Socials
${tg} • ${x} • ${web} • ${dc}

📍 Addresses
Token: ${cand.addr}
Pool:  ${shortAddr(p.pairAddress)}
Dev:   ${devAddr !== '?' ? shortAddr(devAddr) : '?'}

📊 Charts: DEX • GT • BIRD • SCAN • DEF
🤖 Trade: Photon • Axiom • BullX • GMGN • Trojan • Maestro • Banana

📡 DexScreener + GeckoTerminal + Helius + Birdeye

${cand.addr}
https://dexscreener.com/solana/${cand.addr}`;

        // 100% Bulletproof Image Upload
        const imageUrl = p.info?.imageUrl;

        if (imageUrl) {
            try {
                const res = await fetch(imageUrl);
                if (res.ok) {
                    const buffer = await res.buffer();
                    imagePath = path.join(__dirname, `temp_${cand.addr}.jpg`);
                    fs.writeFileSync(imagePath, buffer);
                }
            } catch(e) {
                console.error("Failed to fetch image:", e.message);
            }
        }

        if (imagePath) {
            await client.sendFile(FORWARD_ID, { file: imagePath, caption: msg });
            fs.unlinkSync(imagePath); // Delete the temp image after sending
        } else {
            await client.sendMessage(FORWARD_ID, { message: msg });
        }
        
        console.log(`🏆 10-MIN WINNER POSTED (Image: ${!!imagePath}): ${p.baseToken.symbol}`);
        return true;

    } catch (e) { 
        console.error("Post processing error:", e.message);
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath); // Clean up on error
        return false; 
    }
}

// --- Telegram Listener ---
client.addEventHandler(async (event) => {
    if (event.message.out) return; 
    const text = event.message.text || '';
    const addrs = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (!addrs) return;

    for (const addr of [...new Set(addrs)]) {
        const check = await preCheckToken(addr);
        if (check) {
            candidatePool.set(addr, check);
            console.log(`📥 RAW Token added to 10-Min Arena: ${check.pair.baseToken.symbol} (Rank: ${check.rank}, 5m: ${check.ch5m}%)`);
        }
    }
}, new NewMessage({}));

(async () => {
    await client.connect();
    console.log("🚀 RugAnalyzer (10-Min Battle - Soft Filter Mode) active!");
})();
