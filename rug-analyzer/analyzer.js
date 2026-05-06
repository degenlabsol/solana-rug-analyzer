'use strict';

const { config } = require('./config');

// ─── Formatters ──────────────────────────────────────────────────────────────
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
  if (m < 60)   return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

// ─── Token classification ─────────────────────────────────────────────────────
/**
 * Returns { isNew, isOldHype, skip, reason }
 *  isNew     → recently launched low-cap gem  → full deep check
 *  isOldHype → established token with sudden 5m spike → full deep check
 *  skip      → does not meet either criterion → drop silently
 */
function classifyToken(pair) {
  const mc      = pair?.marketCap || pair?.fdv || 0;
  const liq     = pair?.liquidity?.usd || 0;
  const ch5m    = pair?.priceChange?.m5 || 0;
  const created = pair?.pairCreatedAt  || 0;
  const ageMs   = created ? Date.now() - created : Infinity;

  const isNew = ageMs <= config.bot.newTokenMaxAgeMs;

  if (isNew) {
    // New token: must be early-stage low-cap
    if (mc > 0 && mc < config.bot.newTokenMinMc)
      return { skip: true, reason: `MC too low ($${fmt(mc)}) — dust/trap risk` };
    if (mc > config.bot.newTokenMaxMc)
      return { skip: true, reason: `MC too high ($${fmt(mc)}) — not early enough` };
    if (liq < config.bot.minLiquidityUsd)
      return { skip: true, reason: `Liq too low ($${fmt(liq)})` };
    return { isNew: true, isOldHype: false, skip: false };
  }

  // Old token: only accept with a strong 5m hype spike
  if (ch5m < config.bot.oldTokenMin5mPct)
    return { skip: true, reason: `Old token, weak 5m (${ch5m.toFixed(1)}%) — need +${config.bot.oldTokenMin5mPct}%` };
  if (liq < config.bot.oldTokenMinLiqUsd)
    return { skip: true, reason: `Old token, low liq ($${fmt(liq)})` };

  return { isNew: false, isOldHype: true, skip: false };
}

// ─── Hard reject ─────────────────────────────────────────────────────────────
function hardReject(pair, rugcheck) {
  if (!pair) return 'NO_PAIR_DATA';

  const liq   = pair.liquidity?.usd || 0;
  if (liq < config.bot.minLiquidityUsd) return `LOW_LIQ ($${fmt(liq)})`;

  const ch5m  = pair.priceChange?.m5  || 0;
  const ch1h  = pair.priceChange?.h1  || 0;
  const ch24h = pair.priceChange?.h24 || 0;
  const ch6h  = pair.priceChange?.h6  || 0;

  if (ch5m  <= config.bot.devNukeThreshold) return `DEV_NUKE 5m ${ch5m.toFixed(1)}%`;
  if (ch1h  <= config.bot.devNukeThreshold) return `DEV_NUKE 1h ${ch1h.toFixed(1)}%`;
  if (ch24h <= config.bot.devNukeThreshold) return `DEV_NUKE 24h ${ch24h.toFixed(1)}%`;
  if (ch6h < -25 && ch24h < -25)            return 'DEEP_DUMP 6h+24h';

  if (rugcheck) {
    const ma = rugcheck.token?.mintAuthority;
    const fa = rugcheck.token?.freezeAuthority;
    if (ma !== null && ma !== undefined) return 'MINT_AUTH_ACTIVE';
    if (fa !== null && fa !== undefined) return 'FREEZE_AUTH_ACTIVE';
  }

  return null;
}

// ─── Score ────────────────────────────────────────────────────────────────────
function calcScore(pair, gt, gtInfo, birdeyeData, deployerTxs, rugcheck) {
  let score = 0;
  const checks = [];

  const liq    = pair?.liquidity?.usd || 0;
  const mc     = pair?.marketCap || pair?.fdv || 0;
  const ch5m   = pair?.priceChange?.m5  || 0;
  const ch1h   = pair?.priceChange?.h1  || 0;
  const created = pair?.pairCreatedAt || 0;
  const ageMs  = created ? Date.now() - created : Infinity;
  const isNew  = ageMs <= config.bot.newTokenMaxAgeMs;

  // ── 1. Liquidity (10 pts) ──────────────────────────────────────
  if      (liq >= 50000) { score += 10; checks.push(`✅ +10  Liquidity $${fmt(liq)}`); }
  else if (liq >= 15000) { score += 5;  checks.push(`✅ +5   Liquidity $${fmt(liq)}`); }
  else                   {              checks.push(`⚠️  +0   Liquidity $${fmt(liq)}`); }

  // ── 2. Mint renounced (15 pts) — MANDATORY for safe call ──────
  const isMintRenounced = rugcheck?.token?.mintAuthority   === null
                       || rugcheck?.token?.mintAuthority   === undefined;
  const isFreezeOff     = rugcheck?.token?.freezeAuthority === null
                       || rugcheck?.token?.freezeAuthority === undefined;

  if (isMintRenounced) { score += 15; checks.push('✅ +15  Mint renounced'); }
  else                 {              checks.push('❌  +0   Mint ACTIVE — risky'); }

  // ── 3. Freeze authority (15 pts) ──────────────────────────────
  if (isFreezeOff) { score += 15; checks.push('✅ +15  Freeze authority off'); }
  else             {              checks.push('❌  +0   Freeze ACTIVE — risky'); }

  // ── 4. LP locked/burnt (10 pts) ───────────────────────────────
  if (rugcheck?.risks) {
    const lpRisk = rugcheck.risks.find(r => r.name?.toLowerCase().includes('lp'));
    if (!lpRisk) { score += 10; checks.push('✅ +10  LP Burnt / Locked'); }
    else         {              checks.push(`⚠️  +0   LP: ${lpRisk.description || 'not locked'}`); }
  }

  // ── 5. Buy/Sell ratio 1h (10 pts) ─────────────────────────────
  const buys1h  = pair?.txns?.h1?.buys  || 0;
  const sells1h = pair?.txns?.h1?.sells || 1;
  const bsr     = buys1h / Math.max(sells1h, 1);
  if      (bsr >= 2.0) { score += 10; checks.push(`✅ +10  B/S ${bsr.toFixed(2)}x (1h) — strong buy pressure`); }
  else if (bsr >= 1.4) { score += 6;  checks.push(`✅ +6   B/S ${bsr.toFixed(2)}x (1h)`); }
  else if (bsr >= 1.1) { score += 3;  checks.push(`⚠️  +3   B/S ${bsr.toFixed(2)}x (1h)`); }
  else                 {              checks.push(`❌  +0   B/S ${bsr.toFixed(2)}x (1h) — sell pressure`); }

  // ── 6. Top-10 holder distribution (20 pts) ────────────────────
  if (birdeyeData?.items?.length) {
    const total = birdeyeData.items.reduce((s, h) => s + (h.uiAmount || 0), 0);
    const top10 = birdeyeData.items.slice(0, 10).reduce((s, h) => s + (h.uiAmount || 0), 0);
    const top5  = birdeyeData.items.slice(0, 5).reduce((s, h) => s + (h.uiAmount || 0), 0);
    const p10   = total > 0 ? (top10 / total) * 100 : 100;
    const p5    = total > 0 ? (top5  / total) * 100 : 100;
    if      (p10 < 15) { score += 20; checks.push(`✅ +20  Top 10 very distributed (${p10.toFixed(1)}%)`); }
    else if (p10 < 25) { score += 15; checks.push(`✅ +15  Top 10 distributed (${p10.toFixed(1)}%)`); }
    else if (p10 < 35) { score += 8;  checks.push(`⚠️  +8   Top 10 moderate (${p10.toFixed(1)}%)`); }
    else if (p10 < 45) { score += 3;  checks.push(`⚠️  +3   Top 10 concentrated (${p10.toFixed(1)}%)`); }
    else               {              checks.push(`❌  +0   Top 10 HIGH concentration (${p10.toFixed(1)}%)`); }
  } else if (rugcheck?.topHolders?.length) {
    const p = rugcheck.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) * 100;
    if      (p < 15) { score += 20; checks.push(`✅ +20  Top 10 very distributed (${p.toFixed(1)}%)`); }
    else if (p < 25) { score += 15; checks.push(`✅ +15  Top 10 distributed (${p.toFixed(1)}%)`); }
    else if (p < 35) { score += 8;  checks.push(`⚠️  +8   Top 10 moderate (${p.toFixed(1)}%)`); }
    else if (p < 45) { score += 3;  checks.push(`⚠️  +3   Top 10 concentrated (${p.toFixed(1)}%)`); }
    else             {              checks.push(`❌  +0   Top 10 HIGH concentration (${p.toFixed(1)}%)`); }
  }

  // ── 7. Volume 24h (10 pts) ────────────────────────────────────
  const vol24 = pair?.volume?.h24 || 0;
  if      (vol24 >= 500000) { score += 10; checks.push(`✅ +10  Vol 24h $${fmt(vol24)}`); }
  else if (vol24 >= 100000) { score += 7;  checks.push(`✅ +7   Vol 24h $${fmt(vol24)}`); }
  else if (vol24 >= 20000)  { score += 4;  checks.push(`✅ +4   Vol 24h $${fmt(vol24)}`); }
  else                      {              checks.push(`⚠️  +0   Vol 24h $${fmt(vol24)}`); }

  // ── 8. Trade count 24h (5 pts) ────────────────────────────────
  const trades = (pair?.txns?.h24?.buys || 0) + (pair?.txns?.h24?.sells || 0);
  if      (trades > 5000) { score += 5; checks.push(`✅ +5   ${fmt(trades)} trades 24h`); }
  else if (trades > 500)  { score += 3; checks.push(`✅ +3   ${fmt(trades)} trades 24h`); }
  else                    {             checks.push(`⚠️  +0   ${fmt(trades)} trades 24h`); }

  // ── 9. Deployer history (5 pts) ───────────────────────────────
  if (deployerTxs !== null) {
    const prev = deployerTxs.length;
    if      (prev === 0)  { score += 5; checks.push('✅ +5   Fresh deployer — first token'); }
    else if (prev <= 2)   { score += 2; checks.push(`⚠️  +2   Deployer: ${prev} prev tokens`); }
    else                  {             checks.push(`❌  +0   Deployer: ${prev} prev tokens (serial)`); }
  }

  // ── 10. Socials verified (5 pts) ──────────────────────────────
  const hasSocials = !!(pair?.info?.socials?.length || gtInfo?.twitter_handle || gtInfo?.telegram_handle);
  if (hasSocials) { score += 5; checks.push('✅ +5   Socials verified'); }
  else            {             checks.push('❌  +0   No socials found'); }

  // ── BONUS: early low-cap gem (up to +10 pts, not counted in max) ──
  let earlyBonus = 0;
  let bonusLine  = '';
  if (isNew && mc > 0) {
    if      (mc < 50000)  { earlyBonus = 10; bonusLine = `🌟 +10  EARLY GEM — MC only $${fmt(mc)}!`; }
    else if (mc < 150000) { earlyBonus = 7;  bonusLine = `🌟 +7   Early entry — MC $${fmt(mc)}`; }
    else if (mc < 400000) { earlyBonus = 4;  bonusLine = `🌟 +4   Low cap entry — MC $${fmt(mc)}`; }
    if (bonusLine) checks.push(bonusLine);
    score += earlyBonus;
  }

  // Old token hype bonus
  if (!isNew && ch5m >= config.bot.oldTokenMin5mPct) {
    const hype = Math.min(8, Math.floor(ch5m / 5));
    score += hype;
    checks.push(`🔥 +${hype}  Sudden hype ${pct(ch5m)} in 5m`);
  }

  // Normalise to 100 (max theoretical raw = 120 with bonuses)
  const pctScore = Math.min(100, Math.round((score / 110) * 100));

  let label, emoji, badge;
  if      (pctScore >= 75) { label = 'LIKELY SAFE'; emoji = '🟩'; badge = '🏆 ELITE CALL'; }
  else if (pctScore >= 58) { label = 'CAUTION';     emoji = '🟨'; badge = '⚡️ ENTRY SIGNAL'; }
  else if (pctScore >= 40) { label = 'HIGH RISK';   emoji = '🟧'; badge = '⚠️ RISKY'; }
  else                     { label = 'RUG';          emoji = '🔴'; badge = '☠️ RUG'; }

  return { score: pctScore, label, emoji, badge, checks, isMintRenounced, isFreezeOff, isNew, mc };
}

module.exports = { fmt, pct, short, ageStr, hardReject, calcScore, classifyToken };
