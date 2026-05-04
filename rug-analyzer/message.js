'use strict';

const { fmt, pct, short, ageStr } = require('./analyzer');

function buildRugPost(addr, pair, gt, gtInfo, birdeyeData, scoring, rugcheck) {
  const base   = pair?.baseToken || {};
  const name   = (base.name   || gt?.name   || 'Unknown').replace(/[_*`[\]]/g, '\\$&');
  const symbol = (base.symbol || '???').replace(/[_*`[\]]/g, '\\$&');
  const price  = pair?.priceUsd || gt?.price_usd || '?';
  const mc     = pair?.marketCap || pair?.fdv || gt?.fdv_usd || 0;
  const liq    = pair?.liquidity?.usd || 0;
  const vol24  = pair?.volume?.h24 || 0;
  const pool   = pair?.pairAddress || '';

  const buys24  = pair?.txns?.h24?.buys  || 0;
  const sells24 = pair?.txns?.h24?.sells || 0;
  const bsRatio = sells24 > 0 ? (buys24 / sells24).toFixed(2) : buys24.toString();
  const ch5m    = pair?.priceChange?.m5  || 0;
  const ch1h    = pair?.priceChange?.h1  || 0;
  const ch6h    = pair?.priceChange?.h6  || 0;
  const ch24h   = pair?.priceChange?.h24 || 0;

  let top10Pct = 'N/A';
  let topWalletPct = 'N/A';
  let topWalletAddr = '?';
  let totalHolders = rugcheck?.totalHolders || 'N/A';

  if (birdeyeData?.items && birdeyeData.items.length > 0) {
    const total = birdeyeData.items.reduce((s, h) => s + (h.uiAmount || 0), 0);
    const top10 = birdeyeData.items.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
    top10Pct = total > 0 ? ((top10 / total) * 100).toFixed(1) + '%' : 'N/A';
    if (birdeyeData.items[0]) {
      const tw = birdeyeData.items[0];
      const twPct = total > 0 ? ((tw.uiAmount / total) * 100).toFixed(1) : '?';
      topWalletPct = twPct + '%';
      topWalletAddr = tw.address || '?';
    }
  } else if (rugcheck?.topHolders && rugcheck.topHolders.length > 0) {
    const p = rugcheck.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) * 100;
    top10Pct = p.toFixed(1) + '%';
    const top1 = rugcheck.topHolders[0];
    topWalletPct = ((top1?.pct || 0) * 100).toFixed(1) + '%';
    topWalletAddr = top1?.address || '?';
  }

  const supply = rugcheck?.token?.supply
    ? Number(rugcheck.token.supply).toLocaleString('en-US', { maximumFractionDigits: 3 })
    : 'N/A';

  const mintStatus   = scoring.isMintRenounced ? '✅ Renounced' : '❌ Active';
  const freezeStatus = scoring.isFreezeOff     ? '✅ Off'       : '❌ Active';
  const devAddr      = rugcheck?.creator || rugcheck?.token?.mintAuthority || '?';

  const soc = [];
  const socLinks = pair?.info?.socials || [];
  const tgUrl  = socLinks.find(s => s.type === 'telegram' || s.url?.includes('t.me'))?.url;
  const xUrl   = socLinks.find(s => s.type === 'twitter'  || s.url?.includes('x.com') || s.url?.includes('twitter.com'))?.url;
  const webUrl = pair?.info?.websites?.[0]?.url || gtInfo?.website_url;
  const dcUrl  = socLinks.find(s => s.type === 'discord' || s.url?.includes('discord'))?.url;

  const tgLink  = tgUrl  ? `[TG](${tgUrl})`   : '~TG~';
  const xLink   = xUrl   ? `[𝕏](${xUrl})`     : '~𝕏~';
  const webLink = webUrl ? `[Web](${webUrl})`  : '~Web~';
  const dcLink  = dcUrl  ? `[DC](${dcUrl})`    : '~DC~';

  const a = addr;
  const dexUrl = `https://dexscreener.com/solana/${a}`;

  const msg =
`🔍 RUG ANALYSIS: ${name} ($${symbol})
🛡 Score: ${scoring.score}/100 → ${scoring.emoji} ${scoring.label}
🌱 Age: ${ageStr(pair?.pairCreatedAt)} | ⛓ Solana

📊 Stats
➰ MC:     $${fmt(mc)}
➰ Price:  $${price} (${pct(ch5m)} 5m)
➰ LIQ:    $${fmt(liq)}
➰ Vol:    $${fmt(vol24)} (24h)
➰ Supply: ${supply}

📈 Change
➰ 5M / 1H / 6H / 24H: ${pct(ch5m)} / ${pct(ch1h)} / ${pct(ch6h)} / ${pct(ch24h)}

📉 Trades 24H
➰ Buys: ${buys24.toLocaleString()} | Sells: ${sells24.toLocaleString()} | Ratio: ${bsRatio}

👥 Holders
➰ Total: ${totalHolders}
➰ Top 10: ${top10Pct}
➰ Top Wallet: ${topWalletPct} ${short(topWalletAddr)}

🔐 Authorities
➰ Mint:   ${mintStatus}
➰ Freeze: ${freezeStatus}

👨‍💻 Dev Wallet
➰ Address: ${short(devAddr)}

✅❌ Risk Factors
${scoring.checks.join('\n')}

🔗 Socials
${tgLink} • ${xLink} • ${webLink} • ${dcLink}

📍 Addresses
Token: ${a}
Pool:  ${short(pool)}

📊 Charts: [DEX](${dexUrl}) • [GT](https://www.geckoterminal.com/solana/pools/${pool}) • [BIRD](https://birdeye.so/token/${a}) • [SCAN](https://solscan.io/token/${a}) • [DEF](https://defillama.com/protocol/${a})
🤖 Trade: [Photon](https://photon-sol.tinyastro.io/en/r/@best/${a}) • [Axiom](https://axiom.trade/t/${a}) • [BullX](https://bullx.io/terminal?chainId=1399811149&address=${a}) • [GMGN](https://gmgn.ai/sol/token/${a}) • [Trojan](https://t.me/solana_trojanbot?start=r-rugscan_${a}) • [Maestro](https://t.me/maestro?start=${a}-rugscan)

📡 DexScreener + GeckoTerminal + RugCheck${birdeyeData ? ' + Birdeye' : ''}

${a}
${dexUrl}`;

  return { msg, imageUrl: pair?.info?.imageUrl || gtInfo?.image_url || null };
}

function buildPumperUpdate(symbol, addr, entryMc, currentMc, multiple) {
  const emojis = multiple >= 5 ? '🚀🚀🚀🚀🚀' : multiple >= 3 ? '💸💸💸💸' : '💸💸💸';
  return `📈 ${symbol} ist ${multiple}X gegangen 📈
aus ⚡️ Entry Signal

$${(entryMc / 1000).toFixed(1)}K —> $${(currentMc / 1000).toFixed(1)}K 💵

${emojis}

${addr}
https://dexscreener.com/solana/${addr}`;
}

module.exports = { buildRugPost, buildPumperUpdate };
