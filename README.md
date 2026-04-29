# 🕵️‍♂️ Solana Rug Analyzer (10-Min Battle & Soft Filter Edition)

A sophisticated Telegram Userbot built with Node.js and GramJS. Unlike regular bots, this **Battle Royale Edition** is designed for extreme precision and realistic Solana meme coin trading. It pools every token detected over a 10-minute window, pits them against each other, and forwards only the absolute best "Elite Call" to your target channel.

## ✨ Features

- **10-Minute Battle Royale:** Collects all Contract Addresses (CAs) for 10 minutes. It then sorts them by Rank (Priority A/B/Survivor) and 5-minute performance.
- **The "Highlander" Logic:** Only one winner per cycle. The bot performs deep security checks on the top candidates and posts the best one.
- **Soft Filter System (NEW):** Instead of blindly blocking tokens where the dev hasn't renounced Mint/Freeze authorities yet (which is common for 2-minute-old tokens), the bot calculates a Risk Score and posts warnings (❌ Danger). You make the final decision!
- **Deep Rug-Pull Analysis:** Integrated with the **RugCheck API** to verify:
    - **Holder Distribution:** Skips extreme dumps (Top 10 holders > 75%).
    - **Liquidity & Volume:** Boosts scores for healthy liquidity and high trade counts.
- **Smart Ranking System:**
    - **Priority A:** Fresh tokens (< 2h old) with < 250k Market Cap.
    - **Priority B:** High-momentum tokens (< 48h old) with positive 5m trends.
    - **Survivors:** Established tokens (> 12h old) showing recovery.
- **Bulletproof Image Delivery:** Downloads the token image locally for 1 second to guarantee that Telegram displays the image in your channel, bypassing DexScreener's anti-bot protections.
- **Fully English Output:** Clean, professional, and entirely in English.

---

## 🚀 Installation & Setup

### 1. Prerequisites
- Node.js (v18 or higher)
- Telegram API ID & Hash (from my.telegram.org)
- A Telegram Session String (generated on first run)

### 2. Clone and Install
```bash
git clone https://github.com/degenlabsol/solana-rug-analyzer.git
cd solana-rug-analyzer
npm install
```

### 3. Configuration (.env)
Create a `.env` file in the root directory:
```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_session_string
FORWARD_CHAT_ID=@your_elite_channel
```

### 4. Running the Bot
```bash
pm2 start index.js --name RugAnalyzer
```

---

## 🛠 How the "Battle" Works

1. **Detection:** The bot listens for Solana addresses in any chat. Every valid CA is added to the "Arena" (Memory Pool).
2. **Ranking:** At the end of the 10-minute cycle, candidates are ranked. A fresh token with a +40% trend sits at the top.
3. **Audit:** The bot runs a security audit on the #1 candidate. It checks holders, liquidity, and authorities.
4. **Elite Post:** If the token scores above the minimum threshold (15 points), it is posted with a detailed risk report. If it's pure garbage, it's discarded, and the bot moves to candidate #2.

---

## ⚠️ Disclaimer
This software is for educational and informational purposes only. Trading Solana meme coins involves extreme risk. Always perform your own research (DYOR). The bot is a tool to filter data, not a financial advisor.
