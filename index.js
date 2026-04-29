/* eslint-disable no-console */
'use strict';
require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Anti-Crash
process.on('uncaughtException', e => console.error('⚠️ Exception:', e.message));
process.on('unhandledRejection', r => console.error('⚠️ Rejection:', r));

// ===== CONFIG =====
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION || '';
const FORWARD_ID = process.env.FORWARD_CHAT_ID;

const client = new TelegramClient(
    new StringSession(SESSION),
    API_ID,
    API_HASH,
    { connectionRetries: Infinity, autoReconnect: true }
);

// ===== STATE =====
const candidatePool = new Map();
const postedTokens = new Set();
const historyPool = new Map();
let lastSeenChatId = null;
let lastPostTime = 0;

const MIN_POST_INTERVAL = 28000;

// ===== UTILS =====
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fmtNum = (n) => {
    if (!n || isNaN(n)) return '0.00';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return Number(n).toFixed(2);
};

// FIX: null/undefined → "N/A" statt NaN% (bei frischen Tokens kein priceChange vorhanden)
const fmtPct = n => {
    if (n === undefined || n === null || isNaN(Number(n))) return 'N/A';
    return (Number(n) > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
};

const shortAddr = a => a ? `${a.slice(0, 4)}...${a.slice(-4)}` : '?';

async function fetchWithRetry(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, { timeout: 9000 });
            if (res.ok) return await res.json();
        } catch {}
        await sleep(700);
    }
    return null;
}

async function fetchDex(addr) {
    const data = await fetchWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
    return data?.pairs?.find(p => p.chainId === 'solana') || null;
}

async function fetchRugCheck(addr) {
    return await fetchWithRetry(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
}

// Bild-Fallback über GeckoTerminal wenn DexScreener kein Bild hat
async function fetchGeckoImage(addr) {
    try {
        const json = await fetchWithRetry(
            `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${addr}/info`
        );
        return json?.data?.attributes?.image_url || null;
    } catch {
        return null;
    }
}

// ===== PRE-CHECK =====
async function preCheckToken(addr) {
    const pair = await fetchDex(addr);
    if (!pair) return null;

    const mc = pair.fdv || pair.marketCap || 0;
    const liq = pair.liquidity?.usd || 0;
    const ageH = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;

    if (liq < 1200) return null;

    // Werte als null wenn nicht vorhanden (frische Tokens haben oft keine 5m/1h Daten)
    const ch5m  = pair.priceChange?.m5  ?? null;
    const ch1h  = pair.priceChange?.h1  ?? null;
    const ch6h  = pair.priceChange?.h6  ?? null;
    const ch24h = pair.priceChange?.h24 ?? null;

    // Anti-Dump: harte Grenzen (nur prüfen wenn Wert vorhanden)
    if (ch5m  !== null && ch5m  <= -65) return null;
    if (ch1h  !== null && ch1h  <= -65) return null;
    if (ch24h !== null && ch24h <= -65) return null;

    // Rug-Filter: bereits abgestürzter Token (h24 UND h6 beide stark negativ)
    if (ch24h !== null && ch6h !== null && ch24h <= -40 && ch6h <= -30) {
        console.log(`🚫 Rug-Filter: ${pair.baseToken?.symbol} (24h: ${ch24h}%, 6h: ${ch6h}%)`);
        return null;
    }

    return {
        addr,
        pair,
        mc,
        liq,
        vol: pair.volume?.h24 || 0,
        ageH,
        ch5m,
        ch1h,
        ch6h,
        ch24h,
        ts: Date.now()
    };
}

// ===== KERN: Versucht einen Token zu posten =====
async function tryPostBestToken() {
    if (Date.now() - lastPostTime < MIN_POST_INTERVAL) return false;

    let candidates = Array.from(candidatePool.values())
        .filter(c => !postedTokens.has(c.addr))
        .sort((a, b) => {
            if (Math.abs(a.ageH - b.ageH) > 0.5) return a.ageH - b.ageH;
            return a.mc - b.mc;
        });

    if (candidates.length === 0) return false;

    for (let cand of candidates.slice(0, 4)) {
        await sleep(400);

        // Frische Daten kurz vor dem Post holen → ch5m/ch1h aktuell
        const freshPair = await fetchDex(cand.addr);
        if (freshPair) {
            cand.ch5m  = freshPair.priceChange?.m5  ?? null;
            cand.ch1h  = freshPair.priceChange?.h1  ?? null;
            cand.ch6h  = freshPair.priceChange?.h6  ?? null;
            cand.ch24h = freshPair.priceChange?.h24 ?? null;
            cand.pair  = freshPair;
            cand.mc    = freshPair.fdv || freshPair.marketCap || cand.mc;
            cand.liq   = freshPair.liquidity?.usd || cand.liq;
            cand.vol   = freshPair.volume?.h24 || cand.vol;

            // Rug-Filter nochmal mit frischen Daten
            if (cand.ch24h !== null && cand.ch6h !== null && cand.ch24h <= -40 && cand.ch6h <= -30) {
                console.log(`🚫 Rug-Filter (fresh): ${cand.pair.baseToken?.symbol}`);
                candidatePool.delete(cand.addr);
                continue;
            }
        }

        const rc = await fetchRugCheck(cand.addr);
        let top10 = 0;
        if (rc?.topHolders) {
            top10 = rc.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);
        }

        if (top10 <= 55) {
            const success = await executeDeepCheckAndPost(cand, rc, top10);
            if (success) {
                postedTokens.add(cand.addr);
                candidatePool.delete(cand.addr);

                historyPool.set(cand.addr, {
                    symbol: cand.pair.baseToken.symbol,
                    initialMc: cand.mc,
                    imageUrl: cand.pair.info?.imageUrl,
                    addr: cand.addr,
                    highestMultiplier: 1
                });

                lastPostTime = Date.now();
                return true;
            }
        }
    }
    return false;
}

// ===== TELEGRAM LISTENER =====
client.addEventHandler(async (event) => {
    if (event.message.out) return;

    const text = event.message.text || '';
    const addrs = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (!addrs) return;

    lastSeenChatId = event.message.chatId;

    for (const addr of [...new Set(addrs)]) {
        if (postedTokens.has(addr)) continue;

        if (candidatePool.has(addr)) {
            candidatePool.get(addr).ts = Date.now();
            continue;
        }

        const check = await preCheckToken(addr);
        if (check) {
            candidatePool.set(addr, check);
            console.log(`📥 Neu entdeckt: ${check.pair.baseToken.symbol} ($${fmtNum(check.mc)})`);
            setTimeout(() => tryPostBestToken(), 800);
        }
    }
}, new NewMessage({}));

// ===== 4-Minuten Intervall: Fallback + Cleanup =====
setInterval(async () => {
    const now = Date.now();
    for (let [addr, data] of candidatePool) {
        if (now - data.ts > 18 * 60 * 1000) candidatePool.delete(addr);
    }

    if (Date.now() - lastPostTime > 240000 && candidatePool.size > 0 && lastSeenChatId) {
        console.log(`🔄 Fallback-Check (${candidatePool.size} im Pool)`);
        await tryPostBestToken();
    }

    if (candidatePool.size < 2 && lastSeenChatId) {
        await scrapeHistory(lastSeenChatId);
    }
}, 240000);

// ===== 12-MINUTEN PUMPER UPDATES =====
setInterval(async () => {
    if (historyPool.size === 0) return;
    console.log(`⏱ 12-Min-Pumper-Check: Prüfe ${historyPool.size} alte Calls auf Gewinne...`);

    for (let [addr, data] of historyPool.entries()) {
        await sleep(500);
        let pair = await fetchDex(addr);
        if (!pair) continue;

        let currentMc = pair.fdv || pair.marketCap || 0;
        if (currentMc === 0 || data.initialMc === 0) continue;

        let multiplier = currentMc / data.initialMc;
        let floorMult = Math.floor(multiplier);

        if (floorMult >= 2 && floorMult > data.highestMultiplier) {
            data.highestMultiplier = floorMult;
            historyPool.set(addr, data);

            const msg = `📈 ${data.symbol} is up ${floorMult}X 📈\nfrom ⚡️ Entry Signal\n\n$${fmtNum(data.initialMc)} —> $${fmtNum(currentMc)} 💵\n\n💸💸💸💸\n\n${addr}\nhttps://dexscreener.com/solana/${addr}`;

            let imagePath = null;
            if (data.imageUrl) {
                try {
                    const res = await fetch(data.imageUrl, { timeout: 5000 });
                    if (res.ok) {
                        const buffer = await res.buffer();
                        imagePath = path.join(__dirname, `temp_pump_${addr}.jpg`);
                        fs.writeFileSync(imagePath, buffer);
                    }
                } catch (e) {}
            }

            try {
                if (imagePath) {
                    await client.sendFile(FORWARD_ID, { file: imagePath, caption: msg });
                    fs.unlinkSync(imagePath);
                } else {
                    await client.sendMessage(FORWARD_ID, { message: msg });
                }
                console.log(`🚀 PUMPER UPDATE GEPOSTET: ${data.symbol} hat ${floorMult}X gemacht!`);
            } catch (err) {
                if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                await sleep(2000);
                try {
                    await client.sendMessage(FORWARD_ID, { message: msg });
                } catch (e2) {
                    console.error('⚠️ Pumper-Post fehlgeschlagen:', e2.message);
                }
            }
        }
    }
}, 720000);

// ===== History Scraper =====
async function scrapeHistory(chatId) {
    try {
        const msgs = await client.getMessages(chatId, { limit: 50 });
        let found = new Set();

        for (let m of msgs) {
            const matches = (m.message || '').match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
            if (matches) matches.forEach(a => found.add(a));
        }

        let added = 0;
        for (let addr of found) {
            if (added >= 10 || postedTokens.has(addr) || candidatePool.has(addr)) continue;
            const check = await preCheckToken(addr);
            if (check) {
                candidatePool.set(addr, check);
                console.log(`♻️ Recovered: ${check.pair.baseToken.symbol}`);
                added++;
            }
            await sleep(350);
        }
        if (added > 0) console.log(`♻️ ${added} Tokens aus History wiederhergestellt`);
    } catch (e) {
        console.error('Scrape fehlgeschlagen:', e.message);
    }
}

// ===== POST-FUNKTION (Originales Elite-Layout) =====
async function executeDeepCheckAndPost(cand, rc, top10Pct) {
    let imagePath = null;
    try {
        const p = cand.pair;

        const isMintRenounced = rc ? rc.token?.mintAuthority === null : false;
        const isFreezeOff = rc ? rc.token?.freezeAuthority === null : false;

        const supply = rc?.token?.supply || (cand.mc / (Number(p.priceUsd) || 1));
        const buys24 = p.txns?.h24?.buys || 0;
        const sells24 = p.txns?.h24?.sells || 0;
        const ratio = sells24 > 0 ? (buys24 / sells24).toFixed(2) : buys24.toString();
        const totalTrades = buys24 + sells24;

        let topWalletPct = 0;
        let topWalletAddr = '?';

        if (rc && rc.topHolders && rc.topHolders.length > 0) {
            topWalletPct = (rc.topHolders[0].pct || 0);
            topWalletAddr = rc.topHolders[0].address;
        }

        let score = 0;
        let risks = [];

        if (isMintRenounced) { score += 15; risks.push(`   ✅ +15  Mint Authority renounced`); }
        else { risks.push(`   ❌  0   Mint Authority ACTIVE`); }

        if (isFreezeOff) { score += 15; risks.push(`   ✅ +15  Freeze Authority off`); }
        else { risks.push(`   ❌  0   Freeze Authority ACTIVE`); }

        if (cand.liq > 50000) { score += 15; risks.push(`   ✅ +15  Liquidity $${fmtNum(cand.liq)}`); }
        else { score += 5; risks.push(`   ✅ +5   Liquidity $${fmtNum(cand.liq)}`); }

        if (top10Pct > 0 && top10Pct <= 30) { score += 20; risks.push(`   🌟 +20  Top 10 holders UNDER 30% (${top10Pct.toFixed(1)}%)`); }
        else if (top10Pct > 30 && top10Pct <= 55) { score += 10; risks.push(`   ✅ +10  Top 10 holders ${top10Pct.toFixed(1)}%`); }

        if (cand.vol > 50000) { score += 10; risks.push(`   ✅ +10  Vol24h $${fmtNum(cand.vol)}`); }
        if (totalTrades > 50) { score += 10; risks.push(`   ✅ +10  ${totalTrades} trades 24h`); }

        const devAddr = rc?.creator || '?';

        if (score > 40) score += 30;
        if (score > 100) score = 100;

        const scoreText = score >= 75 ? '🟩 LIKELY SAFE' : (score >= 40 ? '🟨 MID RISK' : '🟥 HIGH RISK');

        const soc = p.info?.socials || [];
        const tg  = soc.find(s => s.type === 'telegram') ? 'TG'  : '~TG~';
        const x   = soc.find(s => s.type === 'twitter')  ? '𝕏'   : '~𝕏~';
        const web = p.info?.websites?.length > 0          ? 'Web' : '~Web~';
        const dc  = soc.find(s => s.type === 'discord')  ? 'DC'  : '~DC~';

        let holdersText = `👥 Holders\n➰ Data syncing (API delay)`;
        if (top10Pct > 0) {
            const totalH = rc?.totalHolders > 0 ? rc.totalHolders : 'N/A';
            holdersText = `👥 Holders\n➰ Total: ${totalH}\n➰ Top 10: ${top10Pct.toFixed(1)}%\n➰ Top Wallet: ${topWalletPct.toFixed(1)}% ${shortAddr(topWalletAddr)}`;
        }

        let devText = '';
        if (devAddr !== '?') {
            devText = `\n\n👨‍💻 Dev Wallet\n➰ Address: ${shortAddr(devAddr)}`;
        }

        const msg =
`🔍 RUG ANALYSIS: ${p.baseToken.name} ($${p.baseToken.symbol})
🛡 Score: ${score}/100 →  ${scoreText}
🌱 Age: ${cand.ageH.toFixed(1)}h | ⛓ Solana

📊 Stats
➰ MC:    $${fmtNum(cand.mc)}
➰ Price: $${p.priceUsd} (${fmtPct(cand.ch5m)} 5m)
➰ LIQ:   $${fmtNum(cand.liq)}
➰ Vol:   $${fmtNum(cand.vol)} (24h)
➰ Supply: ${Number(supply).toLocaleString('en-US', { maximumFractionDigits: 3 })}

📈 Change
➰ 5M / 1H / 6H / 24H: ${fmtPct(cand.ch5m)} / ${fmtPct(cand.ch1h)} / ${fmtPct(cand.ch6h)} / ${fmtPct(cand.ch24h)}

📉 Trades 24H
➰ Buys: ${buys24.toLocaleString()} | Sells: ${sells24.toLocaleString()} | Ratio: ${ratio}

${holdersText}

🔐 Authorities
➰ Mint:   ${isMintRenounced ? '✅ Renounced' : '❌ Active'}
➰ Freeze: ${isFreezeOff ? '✅ Off' : '❌ Active'}${devText}

✅❌ Risk Factors
${risks.join('\n')}

🔗 Socials
${tg} • ${x} • ${web} • ${dc}

📍 Addresses
Token: ${cand.addr}
Pool:  ${shortAddr(p.pairAddress)}

📊 Charts: DEX • GT • BIRD • SCAN • DEF
🤖 Trade: Photon • Axiom • BullX • GMGN • Trojan • Maestro

📡 DexScreener + GeckoTerminal + Helius

${cand.addr}
https://dexscreener.com/solana/${cand.addr}`;

        // ===== BILD: DexScreener zuerst, dann GeckoTerminal als Fallback =====
        let imageUrl = p.info?.imageUrl || null;
        if (!imageUrl) {
            imageUrl = await fetchGeckoImage(cand.addr);
        }

        if (imageUrl) {
            try {
                const res = await fetch(imageUrl, { timeout: 6000 });
                if (res.ok) {
                    const buffer = await res.buffer();
                    imagePath = path.join(__dirname, `temp_${cand.addr}.jpg`);
                    fs.writeFileSync(imagePath, buffer);
                }
            } catch (e) {
                imagePath = null;
            }
        }

        if (imagePath) {
            try {
                await client.sendFile(FORWARD_ID, { file: imagePath, caption: msg });
                fs.unlinkSync(imagePath);
            } catch (err) {
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                await sleep(2000);
                try {
                    await client.sendMessage(FORWARD_ID, { message: msg });
                } catch (e2) {
                    console.error('⚠️ Post-Fallback fehlgeschlagen:', e2.message);
                    return false;
                }
            }
        } else {
            try {
                await client.sendMessage(FORWARD_ID, { message: msg });
            } catch (e) {
                await sleep(2000);
                try {
                    await client.sendMessage(FORWARD_ID, { message: msg });
                } catch (e2) {
                    console.error('⚠️ Post fehlgeschlagen:', e2.message);
                    return false;
                }
            }
        }

        console.log(`🏆 GEPOSTET: ${p.baseToken.symbol} | MC: $${fmtNum(cand.mc)} | Bild: ${!!imagePath}`);
        return true;

    } catch (e) {
        console.error('⚠️ Post processing error:', e.message);
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        return false;
    }
}

// ===== START =====
async function start() {
    while (true) {
        try {
            await client.connect();
            console.log('✅ Telegram Client Connected');
            break;
        } catch (e) {
            console.error('⚠️ Connect-Fehler, retry in 4s:', e.message);
            await sleep(4000);
        }
    }
    console.log('🚀 RugAnalyzer (PRO + Elite Layout + TTL) active!');
}

start();
