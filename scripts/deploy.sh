#!/usr/bin/env zsh
# ============================================================
#  deploy.sh — Tech Corretor
#  Gera DMG (macOS) e EXE (Windows), faz upload para o
#  Firebase Storage e publica o site via Firebase Hosting.
#  Opcionalmente atualiza o servidor na VPS (Google Cloud).
#
#  Uso:
#    ./deploy.sh              → gera tudo + Firebase + VPS (deploy completo)
#    ./deploy.sh --mac        → apenas DMG
#    ./deploy.sh --win        → apenas EXE
#    ./deploy.sh --site       → apenas atualiza o site Firebase (sem rebuild)
#    ./deploy.sh --skip-build → pula o build, sobe os arquivos existentes
#    ./deploy.sh --no-vps     → exclui o deploy na VPS
#    ./deploy.sh --only-vps   → somente atualiza a VPS (pula Firebase/builds)
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

# ── Configuração Firebase / Storage ──────────────────────────
BUCKET="gs://tech-corretor.firebasestorage.app"
DIST_DIR="dist"
PUBLIC_DIR="public"
DMG_NAME="Tech Corretor.dmg"
EXE_NAME="Tech Corretor.exe"
DMG_URL="https://firebasestorage.googleapis.com/v0/b/tech-corretor.firebasestorage.app/o/Tech%20Corretor.dmg?alt=media"
EXE_URL="https://firebasestorage.googleapis.com/v0/b/tech-corretor.firebasestorage.app/o/Tech%20Corretor.exe?alt=media"

# ── Configuração VPS ─────────────────────────────────────────
VPS_INSTANCE="instance-20260701-143850"
VPS_ZONE="us-central1-b"
VPS_IP="34.121.96.26"
VPS_USER="hybriduzapp"
VPS_APP_DIR="/home/hybriduzapp/tech-corretor"

# ── Flags ────────────────────────────────────────────────────
BUILD_MAC=true
BUILD_WIN=true
DEPLOY_SITE=true
DEPLOY_VPS=true
ONLY_VPS=false
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --mac)        BUILD_WIN=false ;;
    --win)        BUILD_MAC=false ;;
    --site)       BUILD_MAC=false; BUILD_WIN=false ;;
    --skip-build) SKIP_BUILD=true ;;
    --no-vps)     DEPLOY_VPS=false ;;
    --only-vps)   ONLY_VPS=true; DEPLOY_VPS=true; BUILD_MAC=false; BUILD_WIN=false; DEPLOY_SITE=false ;;
  esac
done

# ── Pré-requisitos ───────────────────────────────────────────
section "Verificando pré-requisitos"

command -v node    >/dev/null || err "node não encontrado"
command -v npm     >/dev/null || err "npm não encontrado"

if [ "$ONLY_VPS" = false ]; then
  command -v firebase >/dev/null || err "firebase CLI não encontrado (npm install -g firebase-tools)"
  command -v gsutil   >/dev/null || err "gsutil não encontrado (instale o Google Cloud CLI)"
fi

command -v gcloud >/dev/null || err "gcloud não encontrado (instale o Google Cloud CLI)"

ok "Pré-requisitos OK"

# ── Build ────────────────────────────────────────────────────
if [ "$ONLY_VPS" = false ]; then

if [ "$SKIP_BUILD" = false ]; then

  if [ "$BUILD_MAC" = true ]; then
    section "Build macOS (.dmg)"
    log "Limpando artefatos macOS anteriores..."
    rm -f  "$DIST_DIR/Tech Corretor.dmg" "$DIST_DIR/Tech Corretor.dmg.blockmap"
    rm -rf "$DIST_DIR/mac" "$DIST_DIR/mac-arm64"
    npm run dist:mac
    DMG_FILE=$(find "$DIST_DIR" -name "Tech Corretor.dmg" | head -1)
    [ -f "$DMG_FILE" ] || err "Tech Corretor.dmg não encontrado em $DIST_DIR"
    ok "DMG gerado: $DMG_FILE"
  fi

  if [ "$BUILD_WIN" = true ]; then
    section "Build Windows (.exe)"
    log "Limpando artefatos Windows anteriores..."
    rm -f  "$DIST_DIR/Tech Corretor.exe" "$DIST_DIR/Tech Corretor.exe.blockmap"
    rm -rf "$DIST_DIR/win-unpacked" "$DIST_DIR/win-arm64-unpacked"
    rm -f  "$DIST_DIR/"*Setup*.exe "$DIST_DIR/"*Setup*.exe.blockmap
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
    gsutil -h "Content-Type:application/x-apple-diskimage" cp "$DMG_FILE" "$BUCKET/$DMG_NAME"
    gsutil acl ch -u AllUsers:R "$BUCKET/$DMG_NAME"
    ok "DMG publicado → $DMG_URL"
  else
    warn "Nenhum DMG encontrado para upload"
  fi
fi

if [ "$BUILD_WIN" = true ] || [ "$SKIP_BUILD" = true ]; then
  if [ -n "${EXE_FILE:-}" ] && [ -f "$EXE_FILE" ]; then
    log "Enviando EXE... ($(du -sh "$EXE_FILE" | cut -f1))"
    gsutil -h "Content-Type:application/octet-stream" cp "$EXE_FILE" "$BUCKET/$EXE_NAME"
    gsutil acl ch -u AllUsers:R "$BUCKET/$EXE_NAME"
    ok "EXE publicado → $EXE_URL"
  else
    warn "Nenhum EXE encontrado para upload"
  fi
fi

# ── Atualizar site (public/index.html) ───────────────────────
section "Atualizando site de download"

# Garante que o index.html do public/ está atualizado com o do projeto
cp src/index.html "$PUBLIC_DIR/index.html"
ok "public/index.html sincronizado"

# Garante que o script de limpeza do Windows está atualizado no site
cp scripts/limpar-windows.bat "$PUBLIC_DIR/limpar-windows.bat"
ok "public/limpar-windows.bat sincronizado"

# ── Deploy Firebase Hosting ──────────────────────────────────
section "Deploy Firebase Hosting"

firebase deploy --only hosting

fi  # fim do bloco ONLY_VPS=false

# ── Deploy VPS (Google Cloud) ────────────────────────────────
if [ "$DEPLOY_VPS" = true ]; then
  section "Deploy VPS — ${VPS_INSTANCE} (${VPS_ZONE})"
  log "Conectando à instância ${VPS_INSTANCE}..."

  REMOTE_SCRIPT=$(cat << 'ENDSCRIPT'
set -e

echo "📥 Puxando código novo do GitHub..."
sudo -u hybriduzapp git -C /home/hybriduzapp/tech-corretor pull origin main

echo "🔧 Patch whatsapp-web.js timeout 120s..."
sudo perl -i -pe 's/\{ timeout: 30000 \},/{ timeout: 120000 },/g' \
  /home/hybriduzapp/tech-corretor/node_modules/whatsapp-web.js/src/Client.js

echo "� Garantindo ExecStart correto no systemd..."
UNIT=/etc/systemd/system/tech-corretor.service
EXPECTED="ExecStart=/usr/bin/node /home/hybriduzapp/tech-corretor/src/server.js"
if ! grep -qF "$EXPECTED" "$UNIT"; then
  sudo sed -i "s|ExecStart=.*|${EXPECTED}|" "$UNIT"
  sudo systemctl daemon-reload
  echo "   Unit file atualizado."
else
  echo "   Unit file já está correto."
fi

echo "�🔄 Reiniciando serviço..."
sudo systemctl restart tech-corretor

echo "⏳ Aguardando serviço subir..."
sleep 5

STATUS=$(sudo systemctl is-active tech-corretor)
if [ "$STATUS" = "active" ]; then
  echo "✅ Serviço está rodando!"
else
  echo "❌ Serviço com problema. Últimas linhas do log:"
  sudo journalctl -u tech-corretor -n 20 --no-pager
  exit 1
fi

echo ""
echo "📋 Últimas linhas do log:"
sudo journalctl -u tech-corretor -n 10 --no-pager
ENDSCRIPT
  )

  gcloud compute ssh "${VPS_INSTANCE}" --zone="${VPS_ZONE}" --command="${REMOTE_SCRIPT}" \
    || err "Falha ao atualizar a VPS"

  ok "VPS atualizada → http://${VPS_IP}:3000"
fi

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
if [ "$ONLY_VPS" = false ]; then
  echo "  🍎 macOS:   $DMG_URL"
  echo "  🪟 Windows: $EXE_URL"
  echo "  🌐 Site:    https://tech-corretor.web.app"
fi
if [ "$DEPLOY_VPS" = true ]; then
  echo "  🖥️  VPS:     http://${VPS_IP}:3000"
fi
echo ""
