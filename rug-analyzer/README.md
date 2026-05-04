# 🕵️ Rug Analyzer PRO — Elite Sniper v3

> **24/7 Solana Rug Filter & Elite Call Bot**  
> Monitors Telegram source chats, filters rugs, scores tokens, and posts Elite Calls with full on-chain analysis to your channel — automatically.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔍 **Deep Token Analysis** | DexScreener · GeckoTerminal · RugCheck · Birdeye · Helius |
| 🛡 **Hard Reject Filters** | Mint/Freeze auth active · Dev nuke -65% · Deep dump · Low liquidity |
| 📊 **100-Point Scoring** | Liquidity · Security · Holders · Volume · Trades · Deployer · Socials |
| 📸 **One Beautiful Message** | Photo + DexScreener chart preview + all data in a single Telegram post |
| 🚀 **Pumper Alerts** | Auto-notify at 2X · 3X · 4X · 5X · 10X gains |
| 🏆 **Leaderboard** | Top gainers posted every 6h (configurable) |
| 📰 **Daily Market Update** | AI-generated via OpenRouter (daily, English) |
| 🔄 **API Rotation** | Rotates DexScreener endpoints + rate limit protection |
| ⚡ **Fallback Pollers** | DexScreener Profiles · Boosts Latest · Boosts Active (every 3min) |
| 🔁 **Auto-Reconnect** | Infinite retry · flood sleep · anti-crash handlers |

---

## 📸 Sample Output

```
⚡️ ENTRY SIGNAL  |  🟩 Score: 78/100

🪙 TokenName ($SYM) • Solana • Age: 23m

━━━━━━━━━━━━━━━━━━━━━━
💰 Market Data
MC:   $125.4K     Price: $0.000125
LIQ:  $45.2K      Vol:   $890.2K (24h)
Supply: 1,000,000,000

📈 Price Change
5m: +12.3%  •  1h: +45.2%  •  6h: +102.1%  •  24h: +234.5%

🔄 Trades
1h  — Buys: 892  Sells: 341  Ratio: 2.61x
24h — Buys: 8,342  Sells: 3,120  Ratio: 2.67x

👥 Holders
Total: 1,245  •  Top 5: 12.3%  •  Top 10: 23.1%
#1 Wallet: 4.2% — AbcD...efGH

🔐 Security
Mint:   ✅ Renounced
Freeze: ✅ Off
LP:     ✅ Burnt / Locked

...
```

---

## 🚀 Quick Start

### Option 1 — Replit (Hosted, recommended)

1. Fork this repo or open it on [Replit](https://replit.com)
2. Add secrets in the **Secrets** panel (🔒 icon):

| Secret | Value |
|---|---|
| `TELEGRAM_API_ID` | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_SESSION` | See [Generate Session](#-generate-session-string) below |
| `POST_CHAT_ID` | e.g. `@yourchannel` or `-1001234567890` |
| `SOURCE_CHAT_IDS` | e.g. `solearlytrending,degenlabsolgroup` |
| `HELIUS_API_KEY` | [helius.dev](https://helius.dev) — optional |
| `BIRDEYE_API_KEY` | [birdeye.so](https://birdeye.so) — optional |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) — optional |

3. Start the **"Rug Analyzer Bot"** workflow → bot runs 24/7

---

### Option 2 — VPS / Linux Server

```bash
# 1. Clone the repo
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer/rug-analyzer

# 2. Install dependencies
npm install

# 3. Copy and fill in your env file
cp .env.example .env
nano .env

# 4. Generate your Telegram session (once)
node generate-session.js

# 5. Start the bot
node index.js

# Optional: run with pm2 for auto-restart
npm install -g pm2
pm2 start index.js --name rug-analyzer
pm2 save && pm2 startup
```

---

### Option 3 — Android Phone (Termux)

> Run the bot directly on your Android phone, no PC needed.

```bash
# 1. Install Termux from F-Droid (NOT Google Play)
#    https://f-droid.org/packages/com.termux/

# 2. Open Termux and run:
pkg update && pkg upgrade -y
pkg install nodejs git -y

# 3. Clone the repo
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer/rug-analyzer

# 4. Install npm dependencies
npm install

# 5. Copy and edit .env
cp .env.example .env
nano .env
# (fill in your secrets — see table above)

# 6. Generate your Telegram session (once, interactive)
node generate-session.js

# 7. Start the bot
node index.js

# Keep it running after closing Termux:
pkg install tmux -y
tmux new -s rugbot
node index.js
# Detach: Ctrl+B then D
# Reattach later: tmux attach -t rugbot
```

---

## 🔑 Generate Session String

You only need to do this **once**. The session string lets the bot log in as your Telegram account.

```bash
cd rug-analyzer
node generate-session.js
```

Follow the prompts:
1. Enter your **API ID** (from [my.telegram.org](https://my.telegram.org/apps))
2. Enter your **API Hash**
3. Enter your **phone number** (e.g. +49123456789)
4. Enter the **verification code** sent to your Telegram
5. Enter **2FA password** if enabled (or just press Enter)

Copy the printed session string and save it as `TELEGRAM_SESSION` in your secrets / `.env`.

> ⚠️ **Never share your session string.** It gives full access to your Telegram account.

---

## ⚙️ Configuration

All settings are configurable via environment variables. See [`.env.example`](.env.example) for the full list.

### Key Variables

| Variable | Default | Description |
|---|---|---|
| `MIN_LIQUIDITY_USD` | `10000` | Min liquidity to consider a token |
| `MIN_SCORE` | `30` | Min score (0–100) to post a call |
| `POST_COOLDOWN_MS` | `28000` | Cooldown between posts (28s) |
| `POOL_TTL_MS` | `1080000` | Candidate expires after 18min |
| `PUMPER_MULTIPLES` | `2,3,4,5,10` | Alert at these gain multiples |
| `LEADERBOARD_INTERVAL_MS` | `21600000` | Leaderboard post every 6h |
| `MARKET_UPDATE_INTERVAL_MS` | `86400000` | AI market update every 24h |
| `DEV_NUKE_THRESHOLD` | `-65` | Hard reject if price down >65% |
| `MAX_TOP10_PCT` | `55` | Hard reject if top 10 hold >55% |
| `DEX_RATE_LIMIT_MS` | `2000` | Min gap between DexScreener calls |
| `OPENROUTER_MODEL` | `mistralai/mistral-7b-instruct:free` | AI model for market updates |

---

## 📊 Scoring System (100 pts)

| Check | Points |
|---|---|
| Liquidity ≥ $50K | +10 |
| Mint Authority Renounced | +15 |
| Freeze Authority Off | +15 |
| LP Burnt / Locked | +10 |
| Buy/Sell Ratio ≥ 1.5x (1h) | +10 |
| Top 10 Holders < 20% | +20 |
| Volume 24h ≥ $500K | +10 |
| Trades 24h > 10K | +10 |
| Fresh Deployer Wallet | +5 |
| Socials Present | +5 |

| Score | Label | Badge |
|---|---|---|
| 75–100 | LIKELY SAFE | 🏆 ELITE CALL |
| 55–74 | CAUTION | ⚡️ ENTRY SIGNAL |
| 35–54 | HIGH RISK | ⚠️ RISKY |
| 0–34 | RUG | ☠️ RUG |

---

## 🔗 APIs Used

| API | Usage | Free Tier |
|---|---|---|
| [DexScreener](https://docs.dexscreener.com) | Price · Liquidity · Trades · Pairs | ✅ Public |
| [GeckoTerminal](https://www.geckoterminal.com/dex-api) | Token info · Socials | ✅ Public |
| [RugCheck](https://rugcheck.xyz) | Mint/Freeze auth · LP · Holder risk | ✅ Public |
| [Birdeye](https://birdeye.so) | Top holder distribution | 🔑 API key |
| [Helius](https://helius.dev) | Asset metadata · Deployer history | 🔑 API key |
| [OpenRouter](https://openrouter.ai) | Daily AI market update | 🔑 API key (free models available) |

---

## 📁 File Structure

```
rug-analyzer/
├── index.js            # Main bot — event loop, queue, pumper, leaderboard
├── config.js           # All configuration & env variable parsing
├── fetchers.js         # API calls with rotation & rate limiting
├── analyzer.js         # Hard reject filters + 100-point scoring
├── message.js          # Telegram message builder (call, pumper, leaderboard)
├── generate-session.js # One-time Telegram session generator
├── .env.example        # All available environment variables
└── package.json        # Dependencies
```

---

## ⚠️ Disclaimer

This bot is for **educational and informational purposes only**.  
Crypto trading involves significant risk. Always DYOR.  
Never invest more than you can afford to lose.

---

## 📄 License

MIT — free to use, fork, and modify.
