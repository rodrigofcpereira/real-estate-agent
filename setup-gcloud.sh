#!/usr/bin/env bash
# ============================================================
#  setup-gcloud.sh — Tech Corretor
#  Instala o servidor WhatsApp na Google Cloud (e2-micro GRÁTIS)
#
#  VM recomendada: e2-micro (1 CPU, 1GB RAM) — R$0/mês para sempre
#  Este script adiciona 2GB de swap para o Chrome funcionar.
#
#  Como usar (no terminal SSH da VM):
#    curl -fsSL https://raw.githubusercontent.com/rodrigofcpereira/real-estate-agent/main/setup-gcloud.sh | bash
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[setup]${NC} $*"; }
ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
err()     { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ── 1. Atualizar sistema ─────────────────────────────────────
section "Atualizando sistema"
sudo apt-get update -y
sudo apt-get upgrade -y
ok "Sistema atualizado"

# ── 2. Swap de 2GB (essencial no e2-micro) ───────────────────
section "Configurando Swap de 2GB (necessário para o Chrome)"
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ok "Swap de 2GB criado e ativado"
else
  ok "Swap já existe"
fi
free -h | grep -E "Mem|Swap"

# ── 3. Node.js 20 ────────────────────────────────────────────
section "Instalando Node.js 20"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
ok "Node.js $(node -v) / npm $(npm -v)"

# ── 4. Chromium + dependências ───────────────────────────────
section "Instalando Chromium (versão leve)"
sudo apt-get install -y \
  chromium \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 fonts-liberation \
  git curl unzip 2>/dev/null || \
sudo apt-get install -y \
  chromium-browser \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 fonts-liberation \
  git curl unzip

CHROME_BIN=$(command -v chromium 2>/dev/null || command -v chromium-browser 2>/dev/null || echo "")
[ -z "$CHROME_BIN" ] && err "Chromium não encontrado após instalação"
ok "Chromium: $CHROME_BIN"

# ── 5. Clonar / atualizar repositório ────────────────────────
section "Baixando Tech Corretor"
REPO_URL="https://github.com/rodrigofcpereira/real-estate-agent.git"
INSTALL_DIR="$HOME/tech-corretor"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Atualizando repositório existente..."
  cd "$INSTALL_DIR" && git pull origin main
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
ok "Código em $INSTALL_DIR"

# ── 6. Instalar dependências npm ─────────────────────────────
section "Instalando dependências npm"
cd "$INSTALL_DIR"
npm install --omit=dev
ok "Dependências instaladas"

# ── 7. Arquivo .env ──────────────────────────────────────────
section "Configurando variáveis de ambiente"
cat > "$INSTALL_DIR/.env" <<EOF
PORT=3000
CHROMIUM_PATH=$CHROME_BIN
WA_SESSION_PATH=$INSTALL_DIR/.wwebjs_auth
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=512
EOF
ok ".env criado"

# ── 8. Firewall ──────────────────────────────────────────────
section "Abrindo porta 3000 no firewall"
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
ok "Porta 3000 liberada"
warn "Lembre de abrir a porta 3000 também na Google Cloud Console (VPC → Firewall Rules)"

# ── 9. Serviço systemd ───────────────────────────────────────
section "Configurando serviço (auto-start + auto-restart)"
NODE_BIN=$(command -v node)

sudo tee /etc/systemd/system/tech-corretor.service > /dev/null <<EOF
[Unit]
Description=Tech Corretor - WhatsApp Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$NODE_BIN --max-old-space-size=512 $INSTALL_DIR/server.js
Restart=always
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tech-corretor

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tech-corretor
sudo systemctl restart tech-corretor
sleep 3

if sudo systemctl is-active --quiet tech-corretor; then
  ok "Serviço rodando!"
else
  warn "Erro ao iniciar. Veja: sudo journalctl -u tech-corretor -n 30"
fi

# ── 10. Resultado ────────────────────────────────────────────
section "Instalação concluída 🚀"

PUBLIC_IP=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  2>/dev/null || curl -s ifconfig.me 2>/dev/null || echo "SEU_IP")

echo ""
echo -e "${GREEN}${BOLD}✅ Tech Corretor instalado! Custo: R\$0/mês 🎉${NC}"
echo ""
echo -e "  💰 VM: ${BOLD}e2-micro — GRATUITA para sempre${NC}"
echo -e "  💾 RAM: 1GB + 2GB swap = 3GB efetivo"
echo ""
echo -e "  🌐 URL do servidor: ${BOLD}http://${PUBLIC_IP}:3000${NC}"
echo ""
echo -e "  📱 No app Tech Corretor:"
echo -e "     ${BOLD}Configurações → Servidor Cloud → cole: http://${PUBLIC_IP}:3000${NC}"
echo ""
echo -e "  📋 Comandos úteis:"
echo -e "     ${CYAN}sudo systemctl status tech-corretor${NC}   → status"
echo -e "     ${CYAN}sudo journalctl -u tech-corretor -f${NC}   → logs ao vivo"
echo -e "     ${CYAN}sudo systemctl restart tech-corretor${NC}  → reiniciar"
echo -e "     ${CYAN}cd ~/tech-corretor && git pull && sudo systemctl restart tech-corretor${NC} → atualizar"
echo ""
echo -e "${YELLOW}${BOLD}⚠️  OBRIGATÓRIO — Abrir porta 3000 na Google Cloud Console:${NC}"
echo "  1. console.cloud.google.com → VPC Network → Firewall"
echo "  2. 'Create Firewall Rule'"
echo "  3. Name: allow-tech-corretor | TCP: 3000 | Source: 0.0.0.0/0"
echo ""

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[setup]${NC} $*"; }
ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
err()     { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ── 1. Atualizar sistema ─────────────────────────────────────
section "Atualizando sistema"
sudo apt-get update -y
sudo apt-get upgrade -y
ok "Sistema atualizado"

# ── 2. Node.js 20 ────────────────────────────────────────────
section "Instalando Node.js 20"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
ok "Node.js $(node -v) / npm $(npm -v)"

# ── 3. Chromium + dependências ───────────────────────────────
section "Instalando Chromium e dependências"
# No Debian 12 (padrão Google Cloud) o pacote é 'chromium' não 'chromium-browser'
sudo apt-get install -y \
  chromium \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 fonts-liberation \
  git curl unzip xvfb 2>/dev/null || \
sudo apt-get install -y \
  chromium-browser \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 fonts-liberation \
  git curl unzip xvfb

CHROME_BIN=$(command -v chromium 2>/dev/null || command -v chromium-browser 2>/dev/null || echo "")
[ -z "$CHROME_BIN" ] && err "Chromium não encontrado após instalação"
ok "Chromium: $CHROME_BIN"

# ── 4. Clonar / atualizar repositório ────────────────────────
section "Baixando Tech Corretor"
REPO_URL="https://github.com/rodrigofcpereira/real-estate-agent.git"
INSTALL_DIR="$HOME/tech-corretor"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Atualizando repositório existente..."
  cd "$INSTALL_DIR" && git pull origin main
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Código em $INSTALL_DIR"

# ── 5. Instalar dependências npm ─────────────────────────────
section "Instalando dependências npm"
cd "$INSTALL_DIR"
npm install --omit=dev
ok "Dependências instaladas"

# ── 6. Arquivo .env ──────────────────────────────────────────
section "Configurando variáveis de ambiente"
cat > "$INSTALL_DIR/.env" <<EOF
PORT=3000
CHROMIUM_PATH=$CHROME_BIN
WA_SESSION_PATH=$INSTALL_DIR/.wwebjs_auth
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
NODE_ENV=production
EOF
ok ".env criado"

# ── 7. Firewall (ufw) ────────────────────────────────────────
section "Abrindo porta 3000 no firewall"
if command -v ufw &>/dev/null; then
  sudo ufw allow 3000/tcp 2>/dev/null || true
  ok "Porta 3000 liberada no ufw"
fi
# iptables fallback
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
ok "Porta 3000 liberada no iptables"
warn "⚠️  Abra a porta 3000 também no Firewall da Google Cloud Console (VPC → Firewall Rules)"

# ── 8. Serviço systemd ───────────────────────────────────────
section "Configurando serviço systemd (auto-start)"
NODE_BIN=$(command -v node)

sudo tee /etc/systemd/system/tech-corretor.service > /dev/null <<EOF
[Unit]
Description=Tech Corretor - WhatsApp Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tech-corretor

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tech-corretor
sudo systemctl restart tech-corretor
sleep 2

if sudo systemctl is-active --quiet tech-corretor; then
  ok "Serviço rodando!"
else
  warn "Serviço pode ter tido erro. Veja: sudo journalctl -u tech-corretor -n 30"
fi

# ── 9. Resultado ─────────────────────────────────────────────
section "Instalação concluída 🚀"

PUBLIC_IP=$(curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  2>/dev/null || curl -s ifconfig.me 2>/dev/null || echo "SEU_IP")

echo ""
echo -e "${GREEN}${BOLD}✅ Tech Corretor rodando na Google Cloud!${NC}"
echo ""
echo -e "  🌐 URL do servidor: ${BOLD}http://${PUBLIC_IP}:3000${NC}"
echo ""
echo -e "  📱 No app Tech Corretor, vá em:"
echo -e "     ${BOLD}Configurações → Oracle Cloud → cole a URL acima${NC}"
echo ""
echo -e "  📋 Comandos úteis:"
echo -e "     ${CYAN}sudo systemctl status tech-corretor${NC}   → ver status"
echo -e "     ${CYAN}sudo journalctl -u tech-corretor -f${NC}   → ver logs ao vivo"
echo -e "     ${CYAN}sudo systemctl restart tech-corretor${NC}  → reiniciar"
echo -e "     ${CYAN}cd ~/tech-corretor && git pull && sudo systemctl restart tech-corretor${NC} → atualizar"
echo ""
echo -e "${YELLOW}${BOLD}⚠️  PASSO OBRIGATÓRIO — Abrir porta na Google Cloud Console:${NC}"
echo "  1. Acesse: console.cloud.google.com"
echo "  2. Menu → VPC Network → Firewall"
echo "  3. Clique em 'Create Firewall Rule'"
echo "  4. Preencha:"
echo "     • Name: allow-tech-corretor"
echo "     • Targets: All instances"
echo "     • Source: 0.0.0.0/0"
echo "     • TCP ports: 3000"
echo "  5. Clique em 'Create'"
echo ""
