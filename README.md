# 🕵️‍♂️ Solana Rug Analyzer (PRO Elite Sniper Edition)

A hyper-optimized, event-driven Telegram Userbot built with Node.js and GramJS. Designed for professional Solana meme coin trading, this PRO edition abandons slow interval-based checking. Instead, it reacts instantly to new tokens, filters out rugs, caches them in a smart memory pool, and posts the safest "Elite Calls" to your channel with maximum speed.

## ✨ PRO Features

- ⚡ **Event-Driven Sniper (Ultra-Fast):** Scans and posts safe tokens almost instantly. Uses a smart 28-second cooldown between posts to prevent rate-limiting while maintaining maximum speed. Features an `Async Lock` to ensure Telegram APIs are never spammed, even when 10+ tokens are discovered simultaneously.
- 🧠 **Smart Memory Pool (TTL):** Tokens are held in memory for 18 minutes. If a token needs time to mature (e.g., waiting for dev to sell or liquidity to stabilize), it gets picked up in the fallback loop!
- 🛡️ **Hardcore Anti-Dump & Rug Filters:** - Automatically blocks "Dev-Nukes" (ignores tokens dropping > 65% in 5m/1h/24h).
  - Advanced Rug-Filter blocks tokens with simultaneous deep negative 6h and 24h trends.
  - **No 55% Top Holder Limit:** Fresh tokens where Raydium LP holds the majority of the supply will no longer be blocked. The bot posts the token and transparently displays the holder percentage for you to evaluate!
- 🖼️ **Dual-Image Fallback API:** If DexScreener hasn't indexed the token image yet, the bot automatically falls back to the **GeckoTerminal API** to ensure your posts always look incredibly clean.
- 📈 **12-Minute Pumper Updates:** Saves the initial entry Market Cap of every posted token. Every 12 minutes, the bot checks the API. If a token hits 2X, 3X, 4X, it automatically posts a "Pumper Update" to your channel.
- 🔄 **Bulletproof Stability:** Features infinite Auto-Reconnect for Telegram, advanced Error Catching (Anti-Crash), and API Fetch-Retries. It never stops running.

---

## 📊 Example Output (Sniper Post)

```text
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
➰ Total: 154
➰ Top 10: 27.8%
➰ Top Wallet: 7.9% Bvin...XSnz

🔐 Authorities
➰ Mint:   ✅ Renounced
➰ Freeze: ✅ Off

👨‍💻 Dev Wallet
➰ Address: F2aX...8b21

✅❌ Risk Factors
   ✅ +15  Mint Authority renounced
   ✅ +15  Freeze Authority off
   ✅ +10  Liquidity $68.70K
   ✅ +20  Top 10 holders UNDER 30% (27.8%)
   ✅ +10  Vol24h $4.14M
   ✅ +10  41590 trades 24h

🔗 Socials
TG • 𝕏 • Web • DC

📍 Addresses
Token: 4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
Pool:  DUjZ...pjDm

📊 Charts: DEX • GT • BIRD • SCAN • DEF
🤖 Trade: Photon • Axiom • BullX • GMGN • Trojan • Maestro

📡 DexScreener + GeckoTerminal + Helius

4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
https://dexscreener.com/solana/4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
```

---

## 📈 Example Output (Pumper Update)

```text
📈 CREATURES is up 2X 📈
from ⚡️ Entry Signal

$24.9K —> $50.1K 💵

💸💸💸💸

4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
https://dexscreener.com/solana/4y1gkKzCb4qAiH8pH8ft2xvezf6sazurmYDajWXwpump
```

---

## 🚀 Installation & Setup

1. **Clone and Install**
```bash
git clone https://github.com/yourusername/solana-rug-analyzer.git
cd solana-rug-analyzer
npm install
```

2. **Configuration (.env)**
Create a `.env` file in the root directory:
```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_session_string
FORWARD_CHAT_ID=@your_elite_channel
```

3. **Running the Bot**
```bash
pm2 start index.js --name RugAnalyzer
pm2 save
```

## ⚠️ Disclaimer
This software is for educational and informational purposes only. Trading Solana meme coins involves extreme risk. Always perform your own research (DYOR). The bot is a tool to filter data, not a financial advisor.
