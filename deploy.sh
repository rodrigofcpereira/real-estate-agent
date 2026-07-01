#!/usr/bin/env zsh
# ============================================================
#  deploy.sh — Tech Corretor
#  Gera DMG (macOS) e EXE (Windows), faz upload para o
#  Firebase Storage e publica o site via Firebase Hosting.
#
#  Uso:
#    ./deploy.sh              → gera tudo e faz deploy completo
#    ./deploy.sh --mac        → apenas DMG
#    ./deploy.sh --win        → apenas EXE
#    ./deploy.sh --site       → apenas atualiza o site (sem rebuild)
#    ./deploy.sh --skip-build → pula o build, sobe os arquivos existentes
# ============================================================

set -euo pipefail

# ── Cores ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo "${BLUE}[deploy]${NC} $*"; }
ok()      { echo "${GREEN}[✓]${NC} $*"; }
warn()    { echo "${YELLOW}[!]${NC} $*"; }
err()     { echo "${RED}[✗]${NC} $*"; exit 1; }
section() { echo "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ── Configuração ─────────────────────────────────────────────
BUCKET="gs://tech-corretor.firebasestorage.app"
DIST_DIR="dist"
PUBLIC_DIR="public"
DMG_NAME="Tech Corretor.dmg"
EXE_NAME="Tech Corretor.exe"
DMG_URL="https://firebasestorage.googleapis.com/v0/b/tech-corretor.firebasestorage.app/o/Tech%20Corretor.dmg?alt=media"
EXE_URL="https://firebasestorage.googleapis.com/v0/b/tech-corretor.firebasestorage.app/o/Tech%20Corretor.exe?alt=media"

# ── Flags ────────────────────────────────────────────────────
BUILD_MAC=true
BUILD_WIN=true
DEPLOY_SITE=true
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --mac)        BUILD_WIN=false ;;
    --win)        BUILD_MAC=false ;;
    --site)       BUILD_MAC=false; BUILD_WIN=false ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

# ── Pré-requisitos ───────────────────────────────────────────
section "Verificando pré-requisitos"

command -v node    >/dev/null || err "node não encontrado"
command -v npm     >/dev/null || err "npm não encontrado"
command -v firebase>/dev/null || err "firebase CLI não encontrado (npm install -g firebase-tools)"
command -v gsutil  >/dev/null || err "gsutil não encontrado (instale o Google Cloud CLI)"

ok "Pré-requisitos OK"

# ── Build ────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then

  if [ "$BUILD_MAC" = true ]; then
    section "Build macOS (.dmg)"
    npm run dist:mac
    DMG_FILE=$(find "$DIST_DIR" -name "Tech Corretor.dmg" | head -1)
    [ -f "$DMG_FILE" ] || err "Tech Corretor.dmg não encontrado em $DIST_DIR"
    ok "DMG gerado: $DMG_FILE"
  fi

  if [ "$BUILD_WIN" = true ]; then
    section "Build Windows (.exe)"
    npm run dist:win
    EXE_FILE=$(find "$DIST_DIR" -maxdepth 1 -name "Tech Corretor.exe" | head -1)
    [ -f "$EXE_FILE" ] || err "Tech Corretor.exe não encontrado em $DIST_DIR"
    ok "EXE gerado: $EXE_FILE"
  fi

else
  warn "Build ignorado (--skip-build)"
  DMG_FILE=$(find "$DIST_DIR" -name "Tech Corretor.dmg" 2>/dev/null | head -1)
  EXE_FILE=$(find "$DIST_DIR" -maxdepth 1 -name "Tech Corretor.exe" 2>/dev/null | head -1)
fi

# ── Upload Firebase Storage ──────────────────────────────────
section "Upload para Firebase Storage"

if [ "$BUILD_MAC" = true ] || [ "$SKIP_BUILD" = true ]; then
  if [ -n "${DMG_FILE:-}" ] && [ -f "$DMG_FILE" ]; then
    log "Enviando DMG... ($(du -sh "$DMG_FILE" | cut -f1))"
    gsutil cp "$DMG_FILE" "$BUCKET/$DMG_NAME"
    gsutil acl ch -u AllUsers:R "$BUCKET/$DMG_NAME"
    ok "DMG publicado → $DMG_URL"
  else
    warn "Nenhum DMG encontrado para upload"
  fi
fi

if [ "$BUILD_WIN" = true ] || [ "$SKIP_BUILD" = true ]; then
  if [ -n "${EXE_FILE:-}" ] && [ -f "$EXE_FILE" ]; then
    log "Enviando EXE... ($(du -sh "$EXE_FILE" | cut -f1))"
    gsutil cp "$EXE_FILE" "$BUCKET/$EXE_NAME"
    gsutil acl ch -u AllUsers:R "$BUCKET/$EXE_NAME"
    ok "EXE publicado → $EXE_URL"
  else
    warn "Nenhum EXE encontrado para upload"
  fi
fi

# ── Atualizar site (public/index.html) ───────────────────────
section "Atualizando site de download"

# Garante que o index.html do public/ está atualizado com o do projeto
cp index.html "$PUBLIC_DIR/index.html"
ok "public/index.html sincronizado"

# ── Deploy Firebase Hosting ──────────────────────────────────
section "Deploy Firebase Hosting"

firebase deploy --only hosting

# ── Git commit (opcional) ────────────────────────────────────
section "Commit e push git"

if git diff --quiet && git diff --cached --quiet; then
  warn "Nada para commitar no git"
else
  TIMESTAMP=$(date '+%d/%m/%Y %H:%M')
  git add -A
  git commit -m "deploy: atualização $TIMESTAMP"
  git push origin main
  ok "Git atualizado"
fi

# ── Resumo ────────────────────────────────────────────────────
section "Deploy concluído 🚀"
echo ""
echo "  🍎 macOS:   $DMG_URL"
echo "  🪟 Windows: $EXE_URL"
echo "  🌐 Site:    https://tech-corretor.web.app"
echo ""
