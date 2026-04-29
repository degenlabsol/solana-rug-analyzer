​🕵️‍♂️ Solana Rug Analyzer (Elite Sniper 5-Min Edition)
⚠️ Requirement: This bot requires a Telegram channel actively fed by the Solana DEX Tracker.
https://github.com/degenlabsol/solana-dex-tracker
===================================================

A powerful, automated Telegram Userbot built with Node.js and GramJS. Instead of spamming every token it finds, this **Elite Sniper Edition** silently listens to specified Telegram groups, pools Solana token contract addresses for 5 minutes, and compares them. It performs a deep rug-pull risk analysis, applies strict market cap and trend filters, and forwards ONLY the absolute best and safest token to your private target channel.

✨ Features
----------
* **Userbot Capabilities:** Runs on your actual Telegram account. Perfect for extracting signals from private groups where regular bots (@bot) are banned.
* **5-Minute Elite Pool:** Collects CAs over a 5-minute window, compares their 5-minute trends, and picks the ultimate winner. No more channel spam!
* **Multi-API Deep Scan:** Aggregates real-time data from:
  - **DexScreener** (Liquidity, Volume, Price, Pair Age, Image)
  - **RugCheck API** (Mint/Freeze Authorities, Top Holder distribution, Creator History)
  - **Helius / Birdeye / SVS** (Fallback and enhanced data)
* **Strict Anti-Dump & Custom Logic:**
  - **Priority A:** Fresh tokens (< 2h old) with < 100k MC.
  - **Priority B:** Tokens < 48h old, < 100k MC, and a positive 5m trend (> 5%).
  - **Hard Skips:** Instantly ignores tokens dropping > 40% in 5 minutes, exceeding 150k Market Cap, or lacking basic liquidity (< 5k).
* **Flawless Output:** Delivers a perfectly formatted, single-message analysis including the token's image as the caption.

📊 Example Output
-----------------
When a token passes the brutal 5-minute elite filter, the bot forwards a message EXACTLY like this to your target channel (with the token's image):

🔍 RUG ANALYSIS: GoblinGremRaccoonTrollOgrePigeon ($CREATURES)
🛡 Score: 100/100 →  🟩 LIKELY SAFE
🌱 Age: 11.9h | ⛓ Solana

📊 Stats
➰ MC:    $457.98K
➰ Price: $0.00059270 (-48.91% 5m)
➰ LIQ:   $68.70K
➰ Vol:   $4.14M (24h)
➰ Supply: 763,313,904.382

📈 Change
➰ 5M / 1H / 6H / 24H: -48.91% / +142.00% / +6314.00% / +1619.00%

📉 Trades 24H
➰ Buys: 22,312 | Sells: 19,278 | Ratio: 1.16

👥 Holders
➰ Total: 20 (top-N sample)
➰ Top 10: 27.8%
➰ Top Wallet: 7.9% Bvin...XSnz

🔐 Authorities
➰ Mint:   ✅ Renounced
➰ Freeze: ✅ Off

👨‍💻 Dev Wallet
➰ Address: ?
➰ Other Tokens: 0
➰ Recent Tx Types: n/a

✅❌ Risk Factors
   ✅ +15  Mint Authority renounced
   ✅ +15  Freeze Authority off
   ✅ +10  Liquidity $68.70K
   ✅ +5  Top 10 holders 27.8%
   ✅ +5  Vol24h $4.14M
   ✅ +5  41590 trades 24h
   ⚠️  0  ⚠️ Data unavailable: Dev wallet

🔗 Socials
~TG~ • 𝕏 • Web • ~DC~

📍 Addresses
Token: 4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
Pool:  DUjZ...pjDm
Dev:   ?

📊 Charts: DEX • GT • BIRD • SCAN • DEF
🤖 Trade: Photon • Axiom • BullX • GMGN • Trojan • Maestro • Banana

📡 DexScreener + GeckoTerminal + Helius + Birdeye

4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
https://dexscreener.com/solana/4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump


🚀 Installation & Setup
-----------------------
1. Prerequisites
- Node.js (v18 or higher)
- Telegram API ID & Hash: Get them for free at my.telegram.org (under "API development tools").
- API Keys: Helius, Birdeye, etc.

2. Clone and Install
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer
npm install

3. Configuration (.env)
Create a .env file in the root directory:

# Telegram API
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash

# Leave empty for the first run! The bot will generate this for you.
TELEGRAM_SESSION=

# IDs
SOURCE_CHAT_IDS=-100...,-100...
FORWARD_CHAT_ID=-100...

# API Keys
HELIUS_API_KEY=your_key
BIRDEYE_API_KEY=your_key
SVS_API_KEY=your_key

4. First Run (Authentication)
Run the bot for the first time to authenticate your Telegram account:

npm start

The console will prompt you to enter:
- Your phone number (including country code, e.g., +1234567890).
- The login code sent to your Telegram app.
- Your 2FA password (if enabled).

Once authenticated, the console will output a very long string.
⚠️ Copy this string and paste it into your .env file as TELEGRAM_SESSION=....
This allows the bot to restart automatically in the future via PM2 without asking for your phone number again.

⚠️ Disclaimer
-------------
This software is for educational and informational purposes only. Do not use this as financial advice. Trading Solana meme coins is highly risky, and even tokens with a 100/100 score can be rug-pulled. Always DYOR (Do Your Own Research).
