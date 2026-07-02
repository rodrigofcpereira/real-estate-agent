#!/usr/bin/env bash
# ============================================================
#  update-vps.sh — Atualiza o servidor Tech Corretor na VPS
#  Uso: ./update-vps.sh
# ============================================================

INSTANCE="instance-20260701-143850"
ZONE="us-central1-b"
VPS_IP="34.121.96.26"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

echo -e "${BOLD}${CYAN}🚀 Atualizando Tech Corretor na VPS...${NC}"
echo -e "${CYAN}   Instância: ${INSTANCE} (${ZONE})${NC}\n"

# Script que vai rodar na VPS (sem aspas simples internas para não conflitar com --command)
REMOTE_SCRIPT=$(cat << 'ENDSCRIPT'
set -e

echo "📥 Puxando código novo do GitHub..."
sudo -u hybriduzapp git -C /home/hybriduzapp/tech-corretor pull origin main

echo "🔧 Patch whatsapp-web.js timeout 120s..."
sudo perl -i -pe 's/\{ timeout: 30000 \},/{ timeout: 120000 },/g' \
  /home/hybriduzapp/tech-corretor/node_modules/whatsapp-web.js/src/Client.js

echo "🔄 Reiniciando serviço..."
sudo systemctl restart tech-corretor

echo "⏳ Aguardando serviço subir..."
sleep 4

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

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --command="${REMOTE_SCRIPT}"

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}✅ VPS atualizada com sucesso!${NC}"
  echo -e "${CYAN}   Acesse: http://${VPS_IP}:3000${NC}"
else
  echo -e "\n${RED}${BOLD}❌ Algo deu errado. Veja o erro acima.${NC}"
  exit 1
fi
