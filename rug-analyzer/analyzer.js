'use strict';

const { config } = require('./config');

function fmt(n) {
  if (n == null || isNaN(Number(n))) return 'N/A';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n >= 1)   return n.toFixed(2);
  if (n > 0)    return n.toPrecision(4);
  return '0';
}

function pct(n) {
  if (n == null || isNaN(Number(n))) return 'N/A';
  n = Number(n);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function short(a) {
  return a ? `${a.slice(0, 4)}...${a.slice(-4)}` : '?';
}

function ageStr(createdAt) {
  if (!createdAt) return 'N/A';
  const m = Math.floor((Date.now() - createdAt) / 60000);
  if (m < 60)  return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

function hardReject(pair, rugcheck) {
  if (!pair) return 'NO_PAIR_DATA';

  const liq = pair.liquidity?.usd || 0;
  if (liq < config.bot.minLiquidityUsd) return `LOW_LIQ ($${fmt(liq)})`;

  const ch5m  = pair.priceChange?.m5  || 0;
  const ch1h  = pair.priceChange?.h1  || 0;
  const ch24h = pair.priceChange?.h24 || 0;
  const ch6h  = pair.priceChange?.h6  || 0;

  if (ch5m  <= config.bot.devNukeThreshold) return `DEV_NUKE 5m ${ch5m}%`;
  if (ch1h  <= config.bot.devNukeThreshold) return `DEV_NUKE 1h ${ch1h}%`;
  if (ch24h <= config.bot.devNukeThreshold) return `DEV_NUKE 24h ${ch24h}%`;
  if (ch6h < -30 && ch24h < -30)            return 'DEEP_DUMP 6h+24h';

  if (rugcheck) {
    const ma = rugcheck.token?.mintAuthority;
    const fa = rugcheck.token?.freezeAuthority;
    if (ma !== null && ma !== undefined) return 'MINT_AUTH_ACTIVE';
    if (fa !== null && fa !== undefined) return 'FREEZE_AUTH_ACTIVE';
  }

  return null;
}

function calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck) {
  let score = 0;
  const checks = [];
  const liq    = pair?.liquidity?.usd || 0;

  // Liquidity (10pts)
  if      (liq >= 50000) { score += 10; checks.push(`✅ +10  Liquidity $${fmt(liq)}`); }
  else if (liq >= 15000) { score += 5;  checks.push(`✅ +5   Liquidity $${fmt(liq)}`); }
  else                   {              checks.push(`⚠️  +0   Liquidity $${fmt(liq)}`); }

  // Mint authority (15pts)
  const isMintRenounced = rugcheck?.token?.mintAuthority   === null || rugcheck?.token?.mintAuthority   === undefined;
  const isFreezeOff     = rugcheck?.token?.freezeAuthority === null || rugcheck?.token?.freezeAuthority === undefined;
  if (isMintRenounced) { score += 15; checks.push('✅ +15  Mint renounced'); }
  else                 {              checks.push('❌  +0   Mint ACTIVE'); }

  // Freeze authority (15pts)
  if (isFreezeOff) { score += 15; checks.push('✅ +15  Freeze off'); }
  else             {              checks.push('❌  +0   Freeze ACTIVE'); }

  // LP (10pts)
  if (rugcheck?.risks) {
    const lpRisk = rugcheck.risks.find(r => r.name?.toLowerCase().includes('lp'));
    if (!lpRisk) { score += 10; checks.push('✅ +10  LP Burnt/Locked'); }
    else         {              checks.push(`⚠️  +0   LP: ${lpRisk.description || 'not locked'}`); }
  }

  // Buy/sell ratio (10pts)
  const buys  = pair?.txns?.h1?.buys  || 0;
  const sells = pair?.txns?.h1?.sells || 1;
  const bsr   = buys / Math.max(sells, 1);
  if      (bsr >= 1.5) { score += 10; checks.push(`✅ +10  B/S ${bsr.toFixed(2)}x (1h)`); }
  else if (bsr >= 1.2) { score += 5;  checks.push(`⚠️  +5   B/S ${bsr.toFixed(2)}x (1h)`); }
  else                 {              checks.push(`❌  +0   B/S ${bsr.toFixed(2)}x (1h)`); }

  // Top-10 holders (20pts)
  if (birdeyeData?.items?.length) {
    const total = birdeyeData.items.reduce((s, h) => s + (h.uiAmount || 0), 0);
    const top10 = birdeyeData.items.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
    const p     = total > 0 ? (top10 / total) * 100 : 100;
    if      (p < 20) { score += 20; checks.push(`✅ +20  Top 10 < 20% (${p.toFixed(1)}%)`); }
    else if (p < 30) { score += 15; checks.push(`✅ +15  Top 10 < 30% (${p.toFixed(1)}%)`); }
    else if (p < 40) { score += 8;  checks.push(`⚠️  +8   Top 10 ${p.toFixed(1)}%`); }
    else             {              checks.push(`❌  +0   Top 10 HIGH ${p.toFixed(1)}%`); }
  } else if (rugcheck?.topHolders?.length) {
    const p = rugcheck.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) * 100;
    if      (p < 20) { score += 20; checks.push(`✅ +20  Top 10 < 20% (${p.toFixed(1)}%)`); }
    else if (p < 30) { score += 15; checks.push(`✅ +15  Top 10 < 30% (${p.toFixed(1)}%)`); }
    else if (p < 40) { score += 8;  checks.push(`⚠️  +8   Top 10 ${p.toFixed(1)}%`); }
    else             {              checks.push(`❌  +0   Top 10 HIGH ${p.toFixed(1)}%`); }
  }

  // Volume (10pts)
  const vol24 = pair?.volume?.h24 || 0;
  if      (vol24 >= 500000) { score += 10; checks.push(`✅ +10  Vol 24h $${fmt(vol24)}`); }
  else if (vol24 >= 50000)  { score += 5;  checks.push(`✅ +5   Vol 24h $${fmt(vol24)}`); }
  else                      {              checks.push(`⚠️  +0   Vol 24h $${fmt(vol24)}`); }

  // Trade count (10pts)
  const trades = (pair?.txns?.h24?.buys || 0) + (pair?.txns?.h24?.sells || 0);
  if      (trades > 10000) { score += 10; checks.push(`✅ +10  ${fmt(trades)} trades 24h`); }
  else if (trades > 1000)  { score += 5;  checks.push(`✅ +5   ${fmt(trades)} trades 24h`); }
  else                     {              checks.push(`⚠️  +0   ${fmt(trades)} trades 24h`); }

  // Deployer (5pts)
  if (deployerTxs !== null) {
    const prev = deployerTxs.length;
    if      (prev === 0)  { score += 5; checks.push('✅ +5   Fresh deployer wallet'); }
    else if (prev <= 2)   { score += 2; checks.push(`⚠️  +2   Deployer: ${prev} prev tokens`); }
    else                  {             checks.push(`❌  +0   Deployer: ${prev} prev tokens`); }
  }

  // Socials (5pts)
  const hasSocials = !!(pair?.info?.socials?.length || gtInfo?.twitter_handle || gtInfo?.telegram_handle);
  if (hasSocials) { score += 5; checks.push('✅ +5   Socials verified'); }
  else            {             checks.push('❌  +0   No socials found'); }

  const pctScore = Math.min(100, Math.round((score / 110) * 100));

  let label, emoji, badge;
  if      (pctScore >= 75) { label = 'LIKELY SAFE'; emoji = '🟩'; badge = '🏆 ELITE CALL'; }
  else if (pctScore >= 55) { label = 'CAUTION';     emoji = '🟨'; badge = '⚡️ ENTRY SIGNAL'; }
  else if (pctScore >= 35) { label = 'HIGH RISK';   emoji = '🟧'; badge = '⚠️ RISKY';  }
  else                     { label = 'RUG';          emoji = '🔴'; badge = '☠️ RUG';    }

  return { score: pctScore, label, emoji, badge, checks, isMintRenounced, isFreezeOff };
}

module.exports = { fmt, pct, short, ageStr, hardReject, calcScore };
