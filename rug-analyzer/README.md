# Rug Analyzer PRO v3.2

**24/7 Solana Safe Low-Cap Hunter — Telegram Userbot**

Scans source Telegram chats, filters rugs with hard security checks, scores tokens out of 100, and posts the **best one per hour** to your channel.

---

## Table of Contents

- [Requirements](#requirements)
- [Get Telegram API Credentials](#get-telegram-api-credentials)
- [Install on Linux / VPS](#install-on-linux--vps)
- [Install on Windows](#install-on-windows)
- [Install on Android (Termux)](#install-on-android-termux)
- [Generate Your Session String](#generate-your-session-string)
- [Configuration](#configuration)
- [PM2 Commands](#pm2-commands)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Tool | Version | Download |
|---|---|---|
| Node.js | 18 or higher | https://nodejs.org |
| Git | any | https://git-scm.com |
| PM2 | latest | installed via npm |

---

## Get Telegram API Credentials

1. Go to https://my.telegram.org/apps
2. Log in with your Telegram phone number
3. Click **Create new application**
4. Copy your **App api_id** and **App api_hash**

---

## Install on Linux / VPS

Tested on Ubuntu 20.04, 22.04, Debian, Raspberry Pi OS.

```bash
# 1. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Clone the repository
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer/rug-analyzer

# 3. Install dependencies
npm install --omit=optional --ignore-scripts

# 4. Install PM2 globally
npm install -g pm2

# 5. Create config file
cp .env.example .env
nano .env

# 6. Generate your Telegram session string (once only)
node generate-session.js

# 7. Start the bot
pm2 start ecosystem.config.js
pm2 save

# 8. Enable auto-start on reboot (copy and run the command it prints)
pm2 startup
```

---

## Install on Windows

**Step 1 — Install required tools**

- Node.js LTS: https://nodejs.org/en/download — check **"Add to PATH"** during install
- Git: https://git-scm.com/download/win

**Step 2 — Open Command Prompt or PowerShell**

```bat
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer\rug-analyzer

npm install --omit=optional --ignore-scripts

npm install -g pm2

copy .env.example .env
notepad .env
```

**Step 3 — Fill in your `.env` values, save and close Notepad**

**Step 4 — Generate session string (once only)**

```bat
node generate-session.js
```

Copy the printed string and paste it into `.env` as `TELEGRAM_SESSION=...`

**Step 5 — Start the bot**

```bat
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Install on Android (Termux)

**Step 1 — Install Termux from F-Droid**

Download from F-Droid only — the Google Play version is outdated and broken:
https://f-droid.org/packages/com.termux/

**Step 2 — Install Node.js and Git**

```bash
pkg update -y && pkg upgrade -y
pkg install nodejs git -y
```

**Step 3 — Clone the repository**

```bash
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer/rug-analyzer
```

**Step 4 — Install dependencies**

```bash
npm install --omit=optional --ignore-scripts
```

**Step 5 — Install PM2**

```bash
npm install -g pm2
```

**Step 6 — Create config file**

```bash
cp .env.example .env
nano .env
```

Fill in your values (see [Configuration](#configuration) below), then save with **Ctrl+X → Y → Enter**

**Step 7 — Generate session string (once only)**

```bash
node generate-session.js
```

Copy the printed string and paste it into `.env` as `TELEGRAM_SESSION=...`

**Step 8 — Start the bot**

```bash
pm2 start ecosystem.config.js
pm2 save
```

**Step 9 — Keep running after closing Termux**

```bash
pkg install tmux -y
tmux new -s rugbot
pm2 start ecosystem.config.js
# Detach: Ctrl+B then D
# Reattach later: tmux attach -t rugbot
```

---

## Generate Your Session String

Run this once before starting the bot:

```bash
node generate-session.js
```

- Enter your phone number, the code Telegram sends you, and your 2FA password (if set)
- Copy the printed string
- Paste it into `.env` as `TELEGRAM_SESSION=your_string_here`

**Session string expired or stolen?**

If someone else used your session string or you get `AUTH_KEY_DUPLICATED`:

1. Open Telegram on your phone
2. Go to **Settings → Privacy and Security → Active Sessions** (or Devices)
3. Tap **Terminate all other sessions**
4. Run `node generate-session.js` again to create a new session string
5. Update `TELEGRAM_SESSION` in your `.env` with the new string

---

## Configuration

Edit your `.env` file with these values:

### Required

| Variable | Example | Where to get it |
|---|---|---|
| `TELEGRAM_API_ID` | `123456` | https://my.telegram.org/apps |
| `TELEGRAM_API_HASH` | `abc123...` | https://my.telegram.org/apps |
| `TELEGRAM_SESSION` | `1BQA...` | Run `node generate-session.js` |
| `POST_CHAT_ID` | `@mychannel` | Your target Telegram channel |
| `SOURCE_CHAT_IDS` | `chat1,chat2` | Source chats to scan (comma-separated, no @) |

### Optional API Keys

| Variable | Free Tier | What it adds |
|---|---|---|
| `HELIUS_API_KEY` | Yes — https://helius.dev | Deployer history check |
| `BIRDEYE_API_KEY` | Yes — https://birdeye.so | Accurate top-holder data |

### Bot Settings (all optional — defaults shown)

| Variable | Default | Description |
|---|---|---|
| `MIN_SCORE` | `58` | Minimum score out of 100 to post |
| `MIN_LIQUIDITY_USD` | `8000` | Minimum liquidity in USD |
| `NEW_TOKEN_MIN_MC` | `15000` | Min market cap for new tokens |
| `NEW_TOKEN_MAX_MC` | `800000` | Max market cap for new tokens |
| `NEW_TOKEN_MAX_AGE_H` | `3` | Max age in hours to count as new |
| `OLD_TOKEN_MIN_5M_PCT` | `12` | 5m spike required for older tokens |
| `POST_COOLDOWN_MS` | `3600000` | Time between posts (default: 1 hour) |
| `PUMPER_MULTIPLES` | `2,3,5,10` | Alert at these gain multiples |
| `MAX_POOL_SIZE` | `15` | Max candidates in memory (keep low for phones) |

---

## PM2 Commands

```bash
pm2 logs rug-analyzer        # View live logs
pm2 status                   # Check if bot is running
pm2 restart rug-analyzer     # Restart the bot
pm2 stop rug-analyzer        # Stop the bot
pm2 delete rug-analyzer      # Remove from PM2 completely
pm2 monit                    # Live CPU and RAM monitor
```

---

## How It Works

```
Every 5 seconds: check if 1 hour has passed since last post
  └── Yes → pick best candidate from pool → deep analyze → post if score >= 58

Candidates come from:
  1. Live listener on source Telegram chats
  2. DexScreener latest profiles + boosts (polled every 3 minutes as fallback)

A candidate enters the pool only if:
  New token  (< 3h old) → MC between $15K and $800K
  Old token  (> 3h old) → 5m price spike >= +12%

Deep analysis checks (all must pass):
  Mint authority renounced       mandatory — instant reject if not
  Freeze authority off           mandatory — instant reject if not
  Top-10 holders < 45%
  No dev nuke (price drop > -60%)
  LP burnt or locked
  Buy/sell ratio
  Volume and trade count
  Deployer history
  Socials present
```

### Scoring

| Check | Points |
|---|---|
| Liquidity >= $50K | +10 |
| Mint authority renounced | +15 |
| Freeze authority off | +15 |
| LP burnt or locked | +10 |
| Buy/sell ratio >= 2x | +10 |
| Top-10 holders < 15% | +20 |
| Volume 24h >= $500K | +10 |
| Trades 24h > 5,000 | +5 |
| Fresh deployer | +5 |
| Socials verified | +5 |
| Early gem bonus (MC < $50K) | +10 |

| Score | Badge |
|---|---|
| 75 – 100 | ELITE CALL |
| 58 – 74 | ENTRY SIGNAL |
| 40 – 57 | RISKY |
| 0 – 39 | RUG |

---

## Troubleshooting

**AUTH_KEY_DUPLICATED**
Your session is active on another device. Go to Telegram → Settings → Privacy and Security → Active Sessions → Terminate all other sessions. Then generate a new session string.

**AUTH_KEY_UNREGISTERED**
Your session has expired. Run `node generate-session.js` to create a new one.

**Bot starts but never posts**
- Make sure `SOURCE_CHAT_IDS` has active chats that share token addresses
- Check your API keys are correct
- Temporarily lower `MIN_SCORE` to `45` to verify posting works
- Run `pm2 logs rug-analyzer` to see what is happening

**npm install fails on Termux**
Use exactly this command — the flags prevent build errors on Android:
```bash
npm install --omit=optional --ignore-scripts
```

**Session string stolen or compromised**
1. Telegram → Settings → Privacy and Security → Active Sessions → Terminate all
2. Run `node generate-session.js` for a fresh string
3. Update `.env` with the new string and restart the bot

---

## File Structure

```
rug-analyzer/
├── index.js               Main bot — event loop, queue, pumper tracker
├── config.js              All settings and validation
├── fetchers.js            API calls with rate limiting and retries
├── analyzer.js            Token classification, hard filters, scoring
├── message.js             Telegram message builder
├── generate-session.js    One-time session setup tool
├── ecosystem.config.js    PM2 config — auto-restart, memory limit, logs
├── install.sh             Installer for Linux / macOS / Termux
├── install.bat            Installer for Windows
├── .env.example           Config template
└── package.json           Dependencies
```

---

## Disclaimer

Educational and informational purposes only. Crypto trading involves significant risk. Always do your own research. Never invest more than you can afford to lose.

---

## License

MIT
