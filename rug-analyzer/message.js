'use strict';

const { fmt, pct, short, ageStr } = require('./analyzer');

// Medal emojis for leaderboard ranks
const MEDALS = ['🥇', '🥈', '🥉', '4⃣', '5⃣', '6⃣', '7⃣', '8⃣', '9⃣', '🔟', '1⃣1⃣', '1⃣2⃣'];

function socials(pair, gtInfo) {
  const links  = pair?.info?.socials || [];
  const webs   = pair?.info?.websites || [];
  const tgUrl  = links.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url;
  const xUrl   = links.find(s => s.type === 'twitter'  || s.url?.includes('x.com') || s.url?.includes('twitter'))?.url
               || (gtInfo?.twitter_handle ? `https://x.com/${gtInfo.twitter_handle}` : null);
  const webUrl = webs[0]?.url || gtInfo?.website_url;
  const dcUrl  = links.find(s => s.type === 'discord'  || s.url?.includes('discord'))?.url;

  const tg  = tgUrl  ? `[TG](${tgUrl})`  : '~TG~';
  const x   = xUrl   ? `[𝕏](${xUrl})`    : '~𝕏~';
  const web = webUrl ? `[Web](${webUrl})` : '~Web~';
  const dc  = dcUrl  ? `[DC](${dcUrl})`   : '~DC~';
  return { tg, x, web, dc };
}

// ─────────────────────────────────────────
// MAIN CALL POST — ONE message with DexScreener link preview (auto-image)
// ─────────────────────────────────────────
function buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck) {
  const base   = pair?.baseToken || {};
  const name   = (base.name   || gt?.name   || 'Unknown').replace(/[_*`[\]()]/g, '\\$&');
  const symbol = (base.symbol || '???').replace(/[_*`[\]()]/g, '\\$&');

  const price  = pair?.priceUsd  || gt?.price_usd || '?';
  const mc     = pair?.marketCap || pair?.fdv      || gt?.fdv_usd || 0;
  const liq    = pair?.liquidity?.usd              || 0;
  const vol24  = pair?.volume?.h24                 || 0;
  const pool   = pair?.pairAddress                 || '';

  const buys24  = pair?.txns?.h24?.buys   || 0;
  const sells24 = pair?.txns?.h24?.sells  || 0;
  const buys1h  = pair?.txns?.h1?.buys    || 0;
  const sells1h = pair?.txns?.h1?.sells   || 0;
  const bsr24   = sells24 > 0 ? (buys24 / sells24).toFixed(2) : buys24.toString();
  const bsr1h   = sells1h > 0 ? (buys1h / sells1h).toFixed(2) : buys1h.toString();

  const ch5m  = pair?.priceChange?.m5  || 0;
  const ch1h  = pair?.priceChange?.h1  || 0;
  const ch6h  = pair?.priceChange?.h6  || 0;
  const ch24h = pair?.priceChange?.h24 || 0;

  // Holders
  let top10Pct     = 'N/A';
  let top1Pct      = 'N/A';
  let top1Addr     = '?';
  let top5Pct      = 'N/A';
  let totalHolders = rugcheck?.totalHolders ?? 'N/A';

  if (birdeyeData?.items?.length) {
    const items = birdeyeData.items;
    const total = items.reduce((s, h) => s + (h.uiAmount || 0), 0);
    const t10   = items.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
    const t5    = items.slice(0, 5).reduce((s, h) => s + (h.uiAmount || 0), 0);
    top10Pct = total > 0 ? ((t10  / total) * 100).toFixed(1) + '%' : 'N/A';
    top5Pct  = total > 0 ? ((t5   / total) * 100).toFixed(1) + '%' : 'N/A';
    if (items[0]) {
      const tw = items[0];
      top1Pct  = total > 0 ? ((tw.uiAmount / total) * 100).toFixed(1) + '%' : '?';
      top1Addr = tw.address || '?';
    }
  } else if (rugcheck?.topHolders?.length) {
    const th = rugcheck.topHolders;
    const p10 = th.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) * 100;
    const p5  = th.slice(0, 5).reduce((s, h)  => s + (h.pct || 0), 0) * 100;
    top10Pct = p10.toFixed(1) + '%';
    top5Pct  = p5.toFixed(1)  + '%';
    top1Pct  = ((th[0]?.pct || 0) * 100).toFixed(1) + '%';
    top1Addr = th[0]?.address || '?';
  }

  // Security
  const mintStatus   = scoring.isMintRenounced ? '✅ Renounced' : '❌ Active';
  const freezeStatus = scoring.isFreezeOff     ? '✅ Off'       : '❌ Active';

  // LP status
  let lpStatus = '❓ Unknown';
  if (rugcheck?.risks) {
    const lp = rugcheck.risks.find(r => r.name?.toLowerCase().includes('lp'));
    lpStatus = lp ? `⚠️ ${lp.description || 'Not locked'}` : '✅ Burnt / Locked';
  }

  // Deployer
  const devAddr = rugcheck?.creator || rugcheck?.token?.mintAuthority || '?';
  const devShort = short(devAddr);

  // Supply
  const supply = rugcheck?.token?.supply
    ? Number(rugcheck.token.supply).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : 'N/A';

  // Socials
  const soc = socials(pair, gtInfo);

  const dexUrl  = `https://dexscreener.com/solana/${addr}`;
  const gtUrl   = `https://www.geckoterminal.com/solana/pools/${pool}`;
  const birdUrl = `https://birdeye.so/token/${addr}`;
  const scanUrl = `https://solscan.io/token/${addr}`;

  // Trade links
  const tradeLinks = [
    `[Photon](https://photon-sol.tinyastro.io/en/r/@best/${addr})`,
    `[Axiom](https://axiom.trade/t/${addr})`,
    `[BullX](https://bullx.io/terminal?chainId=1399811149&address=${addr})`,
    `[GMGN](https://gmgn.ai/sol/token/${addr})`,
    `[Trojan](https://t.me/solana_trojanbot?start=r-rugscan_${addr})`,
    `[Maestro](https://t.me/maestro?start=${addr}-rugscan)`,
  ].join(' • ');

  // Risk checks — compact
  const checkLines = scoring.checks.join('\n');

  // ── FULL MESSAGE ──────────────────────────────────────────────────
  const msg =
`${scoring.badge}  |  ${scoring.emoji} Score: ${scoring.score}/100

🪙 *${name}* ($${symbol}) • Solana • Age: ${ageStr(pair?.pairCreatedAt)}
📄 *CA:* \`${addr}\`

━━━━━━━━━━━━━━━━━━━━━━
💰 *Market Data*
MC:     $${fmt(mc)}       Price: $${price}
LIQ:    $${fmt(liq)}       Vol:   $${fmt(vol24)} (24h)
Supply: ${supply}

📈 *Price Change*
5m: ${pct(ch5m)}  •  1h: ${pct(ch1h)}  •  6h: ${pct(ch6h)}  •  24h: ${pct(ch24h)}

🔄 *Trades*
1h  — Buys: ${buys1h.toLocaleString()}  Sells: ${sells1h.toLocaleString()}  Ratio: ${bsr1h}x
24h — Buys: ${buys24.toLocaleString()}  Sells: ${sells24.toLocaleString()}  Ratio: ${bsr24}x

👥 *Holders*
Total: ${totalHolders}  •  Top 5: ${top5Pct}  •  Top 10: ${top10Pct}
#1 Wallet: ${top1Pct} — \`${top1Addr.slice(0, 8)}...${top1Addr.slice(-6)}\`

🔐 *Security*
Mint:   ${mintStatus}
Freeze: ${freezeStatus}
LP:     ${lpStatus}

👨‍💻 *Dev Wallet*
${devShort}

✅ *Risk Factors*
${checkLines}

🔗 *Socials*
${soc.tg} • ${soc.x} • ${soc.web} • ${soc.dc}

📊 *Charts*
[DEX](${dexUrl}) • [GT](${gtUrl}) • [BIRD](${birdUrl}) • [SCAN](${scanUrl})

🤖 *Trade*
${tradeLinks}

━━━━━━━━━━━━━━━━━━━━━━
\`${addr}\`
${dexUrl}`;

  const imageUrl = pair?.info?.imageUrl || gtInfo?.image_url || null;
  return { msg, imageUrl, dexUrl };
}

// ─────────────────────────────────────────
// PUMPER UPDATE
// ─────────────────────────────────────────
function buildPumperUpdate(symbol, addr, entryMc, currentMc, multiple) {
  const coins = multiple >= 10 ? '🚀🚀🚀🚀🚀🚀' : multiple >= 5 ? '🚀🚀🚀🚀🚀' : multiple >= 3 ? '💸💸💸💸' : '💸💸💸';
  const dexUrl = `https://dexscreener.com/solana/${addr}`;
  return (
`📈 *${symbol}* is up *${multiple}X* 📈
from ⚡️ Entry Signal

$${fmt(entryMc)} —> $${fmt(currentMc)} 💵

${coins}

\`${addr}\`
${dexUrl}`
  );
}

// ─────────────────────────────────────────
// LEADERBOARD
// ─────────────────────────────────────────
function buildLeaderboard(entries, maxEntries = 12) {
  if (!entries.length) return null;

  const sorted = [...entries]
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, maxEntries);

  const lines = sorted.map((e, i) => {
    const medal  = MEDALS[i] || `${i + 1}.`;
    const social = e.tgUrl  ? ` [TG](${e.tgUrl})`
                 : e.xUrl   ? ` [X](${e.xUrl})`
                 : '';
    return `${medal} ${e.name} | $${e.symbol} • *${e.multiple}X*${social}`;
  });

  return (
`🏆 *Top Early Trending* 💸

${lines.join('\n')}

_Powered by Rug Analyzer PRO_`
  );
}

// ─────────────────────────────────────────
// DAILY MARKET UPDATE wrapper
// ─────────────────────────────────────────
function buildMarketUpdate(aiText) {
  return `${aiText}\n\n_Rug Analyzer PRO • Daily Update_`;
}

module.exports = { buildRugPost, buildPumperUpdate, buildLeaderboard, buildMarketUpdate };
