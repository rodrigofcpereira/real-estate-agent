#!/usr/bin/env bash
# ============================================================
#  setup-https.sh — Tech Corretor
#  Configura Nginx + HTTPS (Let's Encrypt) + remove a porta :3000
#
#  Uso: bash setup-https.sh SEU_DOMINIO.duckdns.org
#  Ex:  bash setup-https.sh techcorretor.duckdns.org
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
err()     { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && err "Informe o domínio: bash setup-https.sh techcorretor.duckdns.org"

section "1. Instalando Nginx e Certbot"
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx
ok "Nginx e Certbot instalados"

section "2. Abrindo portas 80 e 443 no firewall"
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
ok "Portas 80 e 443 liberadas"
warn "Abra também as portas 80 e 443 na Google Cloud Console → VPC → Firewall!"

section "3. Configurando Nginx como proxy reverso"
sudo tee /etc/nginx/sites-available/tech-corretor > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Proxy para o servidor Node.js na porta 3000
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;

        # Suporte a WebSocket (socket.io)
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout  86400;
        proxy_send_timeout  86400;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tech-corretor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "Nginx configurado para $DOMAIN"

section "4. Gerando certificado HTTPS (Let's Encrypt)"
sudo certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "admin@${DOMAIN}" \
  --redirect
ok "Certificado HTTPS gerado!"

section "5. Renovação automática do certificado"
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
ok "Renovação automática configurada (todo dia às 3h)"

section "6. Mantendo CPU aquecida (evita lentidão)"
(crontab -l 2>/dev/null; echo "*/5 * * * * curl -s http://localhost:3000 > /dev/null") | crontab -
ok "Health check a cada 5 minutos ativado"

section "Concluído! 🚀"
echo ""
echo -e "  ${GREEN}${BOLD}✅ HTTPS configurado com sucesso!${NC}"
echo ""
echo -e "  🌐 Acesse agora: ${BOLD}https://${DOMAIN}${NC}"
echo ""
echo -e "  ${YELLOW}⚠️  Lembre de abrir as portas 80 e 443 na Google Cloud Console:${NC}"
echo "     VPC Network → Firewall → Create Rule"
echo "     Name: allow-http-https | TCP: 80,443 | Source: 0.0.0.0/0"
echo ""
