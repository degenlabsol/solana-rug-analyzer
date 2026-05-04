'use strict';

const { config } = require('./config');

function fmt(n) {
  if (n == null || isNaN(Number(n))) return 'N/A';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  if (n >= 1)   return n.toFixed(2);
  if (n > 0)    return n.toPrecision(4);
  return '0';
}

function pct(n) {
  if (n == null || isNaN(Number(n))) return 'N/A';
  n = Number(n);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function short(a) {
  return a ? `${a.slice(0, 4)}...${a.slice(-4)}` : '?';
}

function ageStr(createdAt) {
  if (!createdAt) return 'N/A';
  const diffMs = Date.now() - createdAt;
  const m = Math.floor(diffMs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function hardReject(pair, rugcheck) {
  if (!pair) return 'NO_PAIR_DATA';

  const liq = pair.liquidity?.usd || 0;
  if (liq < config.bot.minLiquidityUsd) return `LOW_LIQ_$${fmt(liq)}`;

  const ch5m  = pair.priceChange?.m5  || 0;
  const ch1h  = pair.priceChange?.h1  || 0;
  const ch6h  = pair.priceChange?.h6  || 0;
  const ch24h = pair.priceChange?.h24 || 0;

  if (ch5m  <= config.bot.devNukeThreshold) return `DEV_NUKE_5m_${ch5m}%`;
  if (ch1h  <= config.bot.devNukeThreshold) return `DEV_NUKE_1h_${ch1h}%`;
  if (ch24h <= config.bot.devNukeThreshold) return `DEV_NUKE_24h_${ch24h}%`;

  if (ch6h < -30 && ch24h < -30) return 'DEEP_DUMP_6h+24h';

  if (rugcheck) {
    const mintAuth   = rugcheck.token?.mintAuthority;
    const freezeAuth = rugcheck.token?.freezeAuthority;
    if (mintAuth   !== null && mintAuth   !== undefined) return 'MINT_AUTH_ACTIVE';
    if (freezeAuth !== null && freezeAuth !== undefined) return 'FREEZE_AUTH_ACTIVE';
  }

  return null;
}

function calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck) {
  let score = 0;
  const checks = [];
  const liq = pair?.liquidity?.usd || 0;

  if (liq >= 50000)      { score += 10; checks.push(`✅ +10  Liquidity $${fmt(liq)}`); }
  else if (liq >= 15000) { score += 5;  checks.push(`✅ +5   Liquidity $${fmt(liq)}`); }
  else                   {              checks.push(`⚠️  +0   Liquidity $${fmt(liq)}`); }

  const isMintRenounced = rugcheck?.token?.mintAuthority   === null || rugcheck?.token?.mintAuthority   === undefined;
  const isFreezeOff     = rugcheck?.token?.freezeAuthority === null || rugcheck?.token?.freezeAuthority === undefined;

  if (isMintRenounced) { score += 15; checks.push('✅ +15  Mint Authority renounced'); }
  else                 {              checks.push('❌ +0   Mint Authority ACTIVE'); }

  if (isFreezeOff) { score += 15; checks.push('✅ +15  Freeze Authority off'); }
  else             {              checks.push('❌ +0   Freeze Authority ACTIVE'); }

  if (rugcheck?.risks) {
    const lpRisk = rugcheck.risks.find(r => r.name?.toLowerCase().includes('lp'));
    if (!lpRisk) { score += 10; checks.push('✅ +10  LP Burnt/Locked'); }
    else         {              checks.push(`⚠️  +0   LP: ${lpRisk.description || 'not locked'}`); }
  }

  const buys  = pair?.txns?.h1?.buys  || 0;
  const sells = pair?.txns?.h1?.sells || 1;
  const bsRatio = buys / Math.max(sells, 1);
  if (bsRatio >= 1.5) { score += 10; checks.push(`✅ +10  B/S Ratio ${bsRatio.toFixed(2)}x (1h)`); }
  else if (bsRatio >= 1.2) { score += 5; checks.push(`⚠️  +5   B/S Ratio ${bsRatio.toFixed(2)}x (1h)`); }
  else                     {            checks.push(`❌ +0   B/S Ratio ${bsRatio.toFixed(2)}x (1h)`); }

  if (birdeyeData?.items) {
    const total = birdeyeData.items.reduce((s, h) => s + (h.uiAmount || 0), 0);
    const top10 = birdeyeData.items.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
    const p = total > 0 ? (top10 / total) * 100 : 100;
    if (p < 20)      { score += 20; checks.push(`✅ +20  Top 10 holders UNDER 20% (${p.toFixed(1)}%)`); }
    else if (p < 30) { score += 15; checks.push(`✅ +15  Top 10 holders UNDER 30% (${p.toFixed(1)}%)`); }
    else if (p < 40) { score += 8;  checks.push(`⚠️  +8   Top 10 holders ${p.toFixed(1)}%`); }
    else             {              checks.push(`❌ +0   Top 10 holders HIGH ${p.toFixed(1)}%`); }
  } else if (rugcheck?.topHolders) {
    const p = rugcheck.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) * 100;
    if (p < 20)      { score += 20; checks.push(`✅ +20  Top 10 holders UNDER 20% (${p.toFixed(1)}%)`); }
    else if (p < 30) { score += 15; checks.push(`✅ +15  Top 10 holders UNDER 30% (${p.toFixed(1)}%)`); }
    else if (p < 40) { score += 8;  checks.push(`⚠️  +8   Top 10 holders ${p.toFixed(1)}%`); }
    else             {              checks.push(`❌ +0   Top 10 holders HIGH ${p.toFixed(1)}%`); }
  }

  const vol24 = pair?.volume?.h24 || 0;
  if (vol24 >= 500000)     { score += 10; checks.push(`✅ +10  Vol24h $${fmt(vol24)}`); }
  else if (vol24 >= 50000) { score += 5;  checks.push(`✅ +5   Vol24h $${fmt(vol24)}`); }
  else                     {              checks.push(`⚠️  +0   Vol24h $${fmt(vol24)}`); }

  const totalTrades = (pair?.txns?.h24?.buys || 0) + (pair?.txns?.h24?.sells || 0);
  if (totalTrades > 10000)  { score += 10; checks.push(`✅ +10  ${fmt(totalTrades)} trades 24h`); }
  else if (totalTrades > 1000) { score += 5; checks.push(`✅ +5   ${fmt(totalTrades)} trades 24h`); }
  else                     {              checks.push(`⚠️  +0   ${fmt(totalTrades)} trades 24h`); }

  if (deployerTxs !== null) {
    const prev = deployerTxs.length;
    if (prev === 0)   { score += 5; checks.push('✅ +5   Deployer: fresh wallet'); }
    else if (prev <= 2) { score += 2; checks.push(`⚠️  +2   Deployer: ${prev} prev tokens`); }
    else              {              checks.push(`❌ +0   Deployer: ${prev} prev tokens (risky)`); }
  }

  const hasSocials = !!(pair?.info?.socials?.length || gtInfo?.twitter_handle || gtInfo?.telegram_handle);
  if (hasSocials) { score += 5; checks.push('✅ +5   Socials present'); }
  else            {             checks.push('❌ +0   No socials'); }

  const max = 110;
  const pctScore = Math.min(100, Math.round((score / max) * 100));
  let label, emoji;
  if (pctScore >= 75)      { label = 'LIKELY SAFE'; emoji = '🟩'; }
  else if (pctScore >= 55) { label = 'CAUTION';     emoji = '🟨'; }
  else if (pctScore >= 35) { label = 'HIGH RISK';   emoji = '🟧'; }
  else                     { label = 'RUG';          emoji = '🔴'; }

  return { score: pctScore, label, emoji, checks, isMintRenounced, isFreezeOff };
}

module.exports = { fmt, pct, short, ageStr, hardReject, calcScore };
