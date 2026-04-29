# 🕵️‍♂️ Solana Rug Analyzer 

A sophisticated Telegram Userbot built with Node.js and GramJS. Unlike regular bots, this **Battle Royale Edition** is designed for extreme precision. It pools every token detected over a 10-minute window, pits them against each other, and forwards only the absolute safest and strongest "Elite Call" to your target channel.

## ✨ Features

- **10-Minute Battle Royale:** Collects all Contract Addresses (CAs) for 10 minutes. It then sorts them by Rank (Priority A/B/Survivor) and 5-minute performance.
- **The "Highlander" Logic:** Only one winner per cycle. The bot performs deep security checks on the top candidates and only posts the first one that is 100% safe.
- **Deep Rug-Pull Analysis:** Integrated with the **RugCheck API** to verify:
    - **Mint Authority:** Must be renounced (No more tokens can be printed).
    - **Freeze Authority:** Must be disabled (Investors cannot be blacklisted).
    - **Holder Distribution:** Top 10 holders must own less than 55%.
- **Smart Ranking System:**
    - **Priority A:** Fresh tokens (< 2h old) with < 250k Market Cap.
    - **Priority B:** High-momentum tokens (< 48h old) with positive 5m trends.
    - **Survivors:** Established tokens (> 12h old) showing recovery.
- **Visual Elite Calls:** Posts the winner with its token image, a detailed risk score (0-100), and comprehensive market stats.
- **Pipeline Ready:** Perfectly syncs with the **Solana DEX Tracker** but can listen to any Telegram group or channel.

---

## 🚀 Installation & Setup

### 1. Prerequisites
- Node.js (v18 or higher)
- Telegram API ID & Hash (from my.telegram.org)
- A Telegram Session String (generated on first run)

### 2. Clone and Install
```bash
git clone <your-repo-link>
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

1. **Detection:** The bot listens for Solana addresses. Every valid CA is added to the "Arena" (Memory Pool).
2. **Ranking:** At the end of the 10-minute cycle, candidates are ranked. A Rank 3 (New/Low MC) token with +40% trend sits at the top.
3. **Audit:** The bot runs a security audit on the #1 candidate. If it's a "Honeypot" (Mint/Freeze active), it is instantly disqualified and the bot moves to candidate #2.
4. **Elite Post:** The first candidate to pass the "Safety Test" is posted to your channel. If no candidate is safe, the pool is cleared and a new round begins.

---

## ⚠️ Disclaimer
This software is for educational and informational purposes only. Trading Solana meme coins involves extreme risk. Always perform your own research (DYOR). The bot is a tool to filter data, not a financial advisor.
