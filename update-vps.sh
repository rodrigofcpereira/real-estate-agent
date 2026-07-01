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

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --command='
  set -e

  echo "📥 Puxando código novo do GitHub..."
  sudo -u hybriduzapp git -C /home/hybriduzapp/tech-corretor pull origin main

  echo "🔄 Reiniciando serviço..."
  sudo systemctl restart tech-corretor

  echo "⏳ Aguardando serviço subir..."
  sleep 3

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
'

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}✅ VPS atualizada com sucesso!${NC}"
  echo -e "${CYAN}   Acesse: http://${VPS_IP}:3000${NC}"
else
  echo -e "\n${RED}${BOLD}❌ Algo deu errado. Veja o erro acima.${NC}"
  exit 1
fi
