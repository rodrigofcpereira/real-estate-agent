#!/usr/bin/env bash
# ============================================================
#  setup-oracle.sh — Tech Corretor
#  Instala e configura o servidor WhatsApp na Oracle Cloud
#
#  Como usar:
#    curl -fsSL https://raw.githubusercontent.com/rodrigofcpereira/real-estate-agent/main/setup-oracle.sh | bash
#
#  Ou manualmente:
#    chmod +x setup-oracle.sh && ./setup-oracle.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ── 1. Node.js 20 ───────────────────────────────────────────
section "Instalando Node.js 20"
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(parseInt(process.version.slice(1)) < 20 ? 1 : 0)' ; echo $?)" == "1" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node -v) instalado"
else
  ok "Node.js $(node -v) já instalado"
fi

# ── 2. Chromium ──────────────────────────────────────────────
section "Instalando Chromium e dependências"
sudo apt-get update -y
sudo apt-get install -y \
  chromium-browser \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 fonts-liberation \
  git curl unzip
ok "Chromium instalado: $(chromium-browser --version 2>/dev/null || chromium --version)"

# ── 3. Clonar / atualizar repositório ────────────────────────
section "Baixando Tech Corretor"
REPO_URL="https://github.com/rodrigofcpereira/real-estate-agent.git"
INSTALL_DIR="$HOME/tech-corretor"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repositório já existe, atualizando..."
  cd "$INSTALL_DIR" && git pull origin main
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Código em $INSTALL_DIR"

# ── 4. Instalar dependências Node ────────────────────────────
section "Instalando dependências npm"
cd "$INSTALL_DIR"
npm install --omit=dev
ok "Dependências instaladas"

# ── 5. Variáveis de ambiente ─────────────────────────────────
section "Configurando variáveis de ambiente"
ENV_FILE="$INSTALL_DIR/.env"
cat > "$ENV_FILE" <<EOF
PORT=3000
CHROMIUM_PATH=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "")
WA_SESSION_PATH=$INSTALL_DIR/.wwebjs_auth
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EOF
ok ".env criado"

# ── 6. Configurar firewall (Oracle Cloud) ────────────────────
section "Abrindo porta 3000 no firewall"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
# Salvar regras iptables (Ubuntu/Debian)
if command -v netfilter-persistent &>/dev/null; then
  sudo netfilter-persistent save 2>/dev/null || true
elif command -v iptables-save &>/dev/null; then
  sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null 2>/dev/null || true
fi
ok "Porta 3000 liberada no iptables"
warn "⚠️  Lembre-se de abrir a porta 3000 nas Security Lists da Oracle Cloud Console!"

# ── 7. Criar serviço systemd ─────────────────────────────────
section "Configurando serviço systemd (auto-start)"
SERVICE_FILE="/etc/systemd/system/tech-corretor.service"
CHROME_PATH=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "")
NODE_PATH=$(command -v node)

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Tech Corretor - WhatsApp Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment=PORT=3000
Environment=CHROMIUM_PATH=$CHROME_PATH
Environment=WA_SESSION_PATH=$INSTALL_DIR/.wwebjs_auth
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ExecStart=$NODE_PATH $INSTALL_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tech-corretor
sudo systemctl restart tech-corretor
ok "Serviço tech-corretor ativado e rodando"

# ── 8. Resultado ─────────────────────────────────────────────
section "Instalação concluída 🚀"

# Pegar IP público
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "SEU_IP")

echo ""
echo -e "${GREEN}${BOLD}✅ Tech Corretor rodando na Oracle Cloud!${NC}"
echo ""
echo -e "  🌐 URL do servidor: ${BOLD}http://${PUBLIC_IP}:3000${NC}"
echo ""
echo -e "  📱 No app, vá em ${BOLD}Configurações → Oracle Cloud${NC}"
echo -e "     e cole esta URL: ${BOLD}http://${PUBLIC_IP}:3000${NC}"
echo ""
echo -e "  📋 Comandos úteis:"
echo -e "     ${CYAN}sudo systemctl status tech-corretor${NC}  → ver status"
echo -e "     ${CYAN}sudo journalctl -u tech-corretor -f${NC}  → ver logs"
echo -e "     ${CYAN}sudo systemctl restart tech-corretor${NC} → reiniciar"
echo ""
warn "⚠️  Abra a porta 3000 na Oracle Console:"
echo "     Oracle Cloud → Networking → VCNs → Security Lists → Ingress Rules"
echo "     Adicione: TCP / Porta 3000 / Source 0.0.0.0/0"
echo ""
