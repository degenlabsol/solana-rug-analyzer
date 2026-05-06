@echo off
REM =============================================================================
REM Rug Analyzer PRO — Windows Install Script
REM Requires: Node.js 18+ already installed from https://nodejs.org
REM =============================================================================

echo.
echo =============================================
echo    Rug Analyzer PRO -- Windows Install
echo =============================================
echo.

REM ── Check Node.js ─────────────────────────────────────────────────────────
node -v >nul 2>&1
IF ERRORLEVEL 1 (
  echo [ERROR] Node.js is not installed.
  echo         Download it from: https://nodejs.org/en/download
  echo         Install the LTS version, then run this script again.
  pause
  exit /b 1
)

FOR /F "tokens=*" %%i IN ('node -v') DO SET NODE_VER=%%i
echo [INFO] Node.js version: %NODE_VER%

REM ── Check Git ──────────────────────────────────────────────────────────────
git --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo [ERROR] Git is not installed.
  echo         Download it from: https://git-scm.com/download/win
  pause
  exit /b 1
)
echo [INFO] Git found.

REM ── Install PM2 ────────────────────────────────────────────────────────────
echo [INFO] Installing PM2...
npm install -g pm2
IF ERRORLEVEL 1 (
  echo [WARN] PM2 install failed. You can still run: node index.js
)

REM ── Clone repo if needed ───────────────────────────────────────────────────
IF NOT EXIST "index.js" (
  IF NOT EXIST "solana-rug-analyzer" (
    echo [INFO] Cloning repository...
    git clone https://github.com/degenlabsol/solana-rug-analyzer.git
  )
  cd solana-rug-analyzer\rug-analyzer
)

REM ── Install npm dependencies ───────────────────────────────────────────────
echo [INFO] Installing npm dependencies...
npm install --production
IF ERRORLEVEL 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

REM ── Create logs folder ─────────────────────────────────────────────────────
IF NOT EXIST "logs" mkdir logs

REM ── Create .env if missing ─────────────────────────────────────────────────
IF NOT EXIST ".env" (
  copy .env.example .env
  echo [INFO] Created .env from .env.example
  echo.
  echo [ACTION REQUIRED] Edit .env with your values:
  echo   - TELEGRAM_API_ID
  echo   - TELEGRAM_API_HASH
  echo   - TELEGRAM_SESSION  (run: node generate-session.js)
  echo   - POST_CHAT_ID
  echo   - SOURCE_CHAT_IDS
  echo.
  notepad .env
) ELSE (
  echo [INFO] .env already exists.
)

echo.
echo =============================================
echo    Installation complete!
echo.
echo    Steps:
echo    1. Make sure .env is filled in
echo    2. Generate session once:
echo         node generate-session.js
echo    3. Start the bot:
echo         pm2 start ecosystem.config.js
echo         pm2 save
echo.
echo    Or run without PM2:
echo         node index.js
echo.
echo    PM2 commands:
echo         pm2 logs rug-analyzer
echo         pm2 status
echo         pm2 restart rug-analyzer
echo =============================================
echo.
pause
