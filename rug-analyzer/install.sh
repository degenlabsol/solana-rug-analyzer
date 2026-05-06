#!/usr/bin/env bash
# =============================================================================
# Rug Analyzer PRO — One-Line Install Script
# Works on: Ubuntu / Debian / Kali / Raspberry Pi / Termux (Android)
# =============================================================================
# Usage:
#   bash install.sh
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================="
echo "   Rug Analyzer PRO — Install Script"
echo "   Supports: Linux / Termux (Android)"
echo "============================================="
echo ""

# ─── Detect environment ───────────────────────────────────────────────────────
IS_TERMUX=false
if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
  IS_TERMUX=true
  info "Detected: Termux (Android)"
else
  info "Detected: Linux"
fi

# ─── Install system dependencies ─────────────────────────────────────────────
if [ "$IS_TERMUX" = true ]; then
  info "Updating Termux packages..."
  pkg update -y && pkg upgrade -y
  info "Installing Node.js, Git, Python, make..."
  pkg install -y nodejs git python make clang

else
  # Standard Linux (Ubuntu/Debian based)
  if command -v apt-get &>/dev/null; then
    info "Updating apt packages..."
    sudo apt-get update -y
    info "Installing dependencies..."
    sudo apt-get install -y curl git build-essential python3

    # Install Node.js 20 LTS via NodeSource
    if ! command -v node &>/dev/null; then
      info "Installing Node.js 20 LTS..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y nodejs git gcc-c++ make python3
  elif command -v pacman &>/dev/null; then
    sudo pacman -Sy --noconfirm nodejs npm git base-devel python
  else
    warn "Unknown package manager. Make sure Node.js 18+ and Git are installed."
  fi
fi

# ─── Verify Node.js ───────────────────────────────────────────────────────────
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18 or higher is required. Current: $(node -v 2>/dev/null || echo 'not found')"
fi
info "Node.js version: $(node -v)"
info "npm version    : $(npm -v)"

# ─── Install PM2 globally ─────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2 (process manager)..."
  npm install -g pm2
else
  info "PM2 already installed: $(pm2 -v)"
fi

# ─── Clone repo if not already in the folder ─────────────────────────────────
if [ ! -f "index.js" ]; then
  # We're not inside rug-analyzer/ — check if we need to clone
  if [ ! -d "solana-rug-analyzer" ]; then
    info "Cloning repository..."
    git clone https://github.com/degenlabsol/solana-rug-analyzer.git
  fi
  cd solana-rug-analyzer/rug-analyzer
else
  info "Already inside rug-analyzer/ — skipping clone."
fi

# ─── Install npm dependencies ─────────────────────────────────────────────────
info "Installing npm dependencies..."
npm install --production

# ─── Create logs directory ────────────────────────────────────────────────────
mkdir -p logs

# ─── Setup .env ───────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn "Created .env from .env.example"
  warn "NEXT STEPS:"
  warn "  1. Edit .env and fill in your values:"
  warn "       nano .env"
  warn "  2. Generate your Telegram session string:"
  warn "       node generate-session.js"
  warn "  3. Start the bot:"
  warn "       pm2 start ecosystem.config.js"
  warn "       pm2 save"
  warn "       pm2 startup   <-- follow the printed command"
else
  info ".env already exists — skipping copy."
fi

echo ""
echo "============================================="
echo "   Installation complete!"
echo ""
echo "   Next steps:"
echo "   1. Edit your config:"
echo "        nano .env"
echo ""
echo "   2. Generate Telegram session (once only):"
echo "        node generate-session.js"
echo ""
echo "   3. Start the bot with PM2:"
echo "        pm2 start ecosystem.config.js"
echo "        pm2 save"
echo "        pm2 startup"
echo ""
echo "   Useful PM2 commands:"
echo "        pm2 logs rug-analyzer    -- view live logs"
echo "        pm2 status               -- check status"
echo "        pm2 restart rug-analyzer -- restart"
echo "        pm2 stop rug-analyzer    -- stop"
echo "============================================="
echo ""
