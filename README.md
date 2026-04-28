# 🕵️‍♂️ Solana Rug Analyzer (Userbot Edition)

![Node.js](https://img.shields.io/badge/Node.js-18.x-green)
![GramJS](https://img.shields.io/badge/GramJS-Telegram-blue)
![Solana](https://img.shields.io/badge/Solana-Web3-purple)
![License](https://img.shields.io/badge/License-MIT-brightgreen)

A powerful, automated Telegram **Userbot** built with Node.js and [GramJS](https://painor.gitbook.io/gramjs/). 
It silently listens to specified Telegram groups, channels, or private chats (bypassing normal bot restrictions), extracts Solana token contract addresses, and performs a deep rug-pull risk analysis in under a second. If a token passes your custom safety threshold, it forwards a highly detailed report to your private target channel.

## ✨ Features
* **Userbot Capabilities:** Runs on your actual Telegram account. Perfect for extracting signals from private groups where regular bots (`@bot`) are banned.
* **Multi-API Deep Scan:** Aggregates real-time data from:
  * [DexScreener](https://dexscreener.com/) (Liquidity, Volume, Price, Pair Age)
  * [GeckoTerminal](https://www.geckoterminal.com/) (Socials, GT Score, Websites)
  * [Helius RPC](https://www.helius.dev/) (Holder distribution, Mint/Freeze Authorities, Dev Wallet History)
  * [Birdeye](https://birdeye.so/) & Solana Vibe Station (Fallback pricing)
* **Custom Scoring System:** Automatically grades tokens from `0` (Rug) to `100` (Likely Safe) based on liquidity, holder distribution, LP burn status, and creator history.
* **Smart Anti-Spam:** Remembers recently scanned tokens to prevent spamming your target channel.

---

## 📊 Example Output
When a token scores above your `MIN_FORWARD_SCORE`, the bot forwards a message like this to your target channel:

> 🔍 **RUG ANALYSIS: Uncle Scam Altman ($USA)**
> 🛡 Score: **80/100** →  🟩 LIKELY SAFE
> 🌱 Age: 16m | ⛓ Solana
> 
> 📊 **Stats**
> ➰ MC:    $54.46K
> ➰ Price: $0.00005446 (+38.92% 5m)
> ➰ LIQ:   $18.10K
> ➰ Vol:   $106.15K (24h)
> ➰ Supply: 1,000,000,000
> 
> 📈 **Change**
> ➰ 5M / 1H / 6H / 24H: +38.9% / +55.4% / +55.4% / +55.4%
> 
> 👥 **Holders**
> ➰ Total: 20 (top-N sample)
> ➰ Top 10: 22.6%
> ➰ Top Wallet: 15.6% [7jHs...NK8t]
> 
> 🔐 **Authorities**
> ➰ Mint:   ✅ Renounced
> ➰ Freeze: ✅ Off
> 
> ✅❌ **Risk Factors**
>    ✅ +15  Mint Authority renounced
>    ✅ +15  Freeze Authority off
>    ✅ +5   Top 10 holders 22.6%
>    ✅ +5   Vol24h $106.15K
>    ❌ -5   Age 16m (<1h)
> 
> 🔗 **Socials**
> [TG](https://t.me/...) • [𝕏](https://x.com/...) • [Web](https://...)
> 
> 📍 **Addresses**
> Token: `Bg4ApPaiPkRqLNNcN1yahpYPMDhiSCCFqtRhdVyRpump`
> 
> 📊 **Charts:** [DEX] • [GT] • [BIRD] • [SCAN]
> 🤖 **Trade:** [Photon] • [BullX] • [Trojan] • [Maestro]

---

## 🚀 Installation & Setup

### 1. Prerequisites
* **Node.js** (v18 or higher)
* **Telegram API ID & Hash:** Get them for free at [my.telegram.org](https://my.telegram.org/) (under "API development tools").
* **Helius API Key:** Highly recommended for holder and authority checks. Get it at [Helius.dev](https://www.helius.dev/).

### 2. Clone and Install
```bash
git clone [https://github.com/degenlabsol/solana-rug-analyzer.git](https://github.com/degenlabsol/solana-rug-analyzer.git)
cd solana-rug-analyzer
npm install


### 3. Configuration (.env)
Create a .env file in the root directory based on the provided .env.example:

# Get these from my.telegram.org
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_api_hash_here

# Leave empty for the first run! The bot will generate this for you.
TELEGRAM_SESSION=

# Chat Usernames or IDs (comma-separated for sources)
SOURCE_CHAT_IDS=group_username1,group_username2
FORWARD_CHAT_ID=my_private_signal_channel

# API Keys
HELIUS_API_KEY=your_helius_key_here
BIRDEYE_API_KEY=
SVS_API_KEY=

# Settings
MIN_FORWARD_SCORE=60
RATE_LIMIT_MS=8000
ANALYSIS_TIMEOUT_MS=15000

### 4. First Run (Authentication)
Run the bot for the first time to authenticate your Telegram account:

npm start

The console will prompt you to enter:

Your phone number (including country code, e.g., +1234567890).

The login code sent to your Telegram app.

Your 2FA password (if enabled).

Once authenticated, the console will output a very long string.
⚠️ Copy this string and paste it into your .env file as TELEGRAM_SESSION=....
This allows the bot to restart automatically in the future without asking for your phone number again.

⚙️ Commands
You can interact with the Userbot directly in your chats:

/check <ContractAddress> - Force an immediate analysis of a specific token.

/threshold <0-100> - Dynamically adjust the minimum score required to forward a token.

/stats - View current bot uptime, analyzed tokens, and blocked rugs.

⚠️ Disclaimer
This software is for educational and informational purposes only. Do not use this as financial advice. Trading Solana meme coins is highly risky, and even tokens with a 100/100 score can be rug-pulled. Always DYOR (Do Your Own Research).
