#!/usr/bin/env bash
# cpro-util setup script
# Checks prerequisites, installs dependencies, builds, and launches the web UI.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${CYAN}→${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; exit 1; }
header() { echo -e "\n${BOLD}$*${RESET}"; }

header "cpro-util · Finalmouse Centerpiece Pro skin converter"
echo    "  Setup script — checks prerequisites, builds, and launches the web UI"
echo

# ── 1. Node.js ────────────────────────────────────────────────────────────────
header "Checking prerequisites"

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org and re-run this script."
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js 20+ required (you have $(node --version)). Update at https://nodejs.org"
fi
ok "Node.js $(node --version)"

# ── 2. npm ────────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  fail "npm not found. It ships with Node.js — try reinstalling from https://nodejs.org"
fi
ok "npm $(npm --version)"

# ── 3. yt-dlp (optional — only needed for YouTube/Vimeo URL conversion) ───────
YTDLP_STATUS="not installed"
if command -v yt-dlp &>/dev/null; then
  YTDLP_STATUS="$(yt-dlp --version)"
  ok "yt-dlp $YTDLP_STATUS"
else
  warn "yt-dlp not found — YouTube/Vimeo URL downloads will be unavailable."
  echo    "     Install with:  brew install yt-dlp   (macOS/Homebrew)"
  echo    "                or: pip install yt-dlp"
  echo    "     You can still convert local files and GIFs without it."
fi

# Note: ffmpeg and ffprobe are bundled as npm packages — no separate install needed.
ok "ffmpeg/ffprobe  (bundled via npm — no separate install needed)"

# ── 4. Install npm dependencies ───────────────────────────────────────────────
header "Installing dependencies"
info "Running npm install…"
npm install
ok "Dependencies installed"

# ── 5. Build ──────────────────────────────────────────────────────────────────
header "Building"
info "Running npm run build…"
npm run build
ok "Build complete"

# ── 6. Launch web UI ──────────────────────────────────────────────────────────
header "Done!"
echo
echo -e "  ${BOLD}Everything is ready.${RESET}"
echo
echo -e "  ${CYAN}Launch the web UI any time with:${RESET}"
echo    "    npm run serve"
echo    "    (or: node dist/cli.js serve)"
echo
echo -e "  ${CYAN}CLI usage:${RESET}"
echo    "    node dist/cli.js convert <file>          # convert a local file"
echo    "    node dist/cli.js convert <youtube-url>   # download + convert (requires yt-dlp)"
echo    "    node dist/cli.js --help                  # all commands"
echo
echo -e "  ${CYAN}(Optional) Install globally as \`cpro\`:${RESET}"
echo    "    npm link"
echo    "    cpro serve"
echo

read -r -p "Launch the web UI now? [Y/n] " LAUNCH
LAUNCH="${LAUNCH:-y}"
if [[ "$LAUNCH" =~ ^[Yy]$ ]]; then
  info "Starting cpro-util at http://127.0.0.1:7777 …"
  node dist/cli.js serve
fi
