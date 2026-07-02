# Tech Corretor

Painel de gestão de contratos imobiliários com envio de mensagens via WhatsApp.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Desktop | Electron ~40 |
| Backend | Node.js 20 + Express + Socket.io |
| WhatsApp | whatsapp-web.js + Puppeteer |
| Banco de dados | Firebase Firestore |
| Auth | Firebase Auth |
| Hosting (site) | Firebase Hosting — `tech-corretor.web.app` |
| VPS (WhatsApp 24/7) | Google Cloud e2-micro — `34.121.96.26:3000` |

---

## Rodar localmente

```bash
npm install
npm run dev        # inicia o servidor com nodemon
# abrir http://localhost:3000 no navegador
```

---

## Atualizar o servidor na VPS (Google Cloud)

Sim, dá para fazer tudo via linha de comando do seu Mac.

### Opção 1 — SSH direto pelo terminal

```bash
# 1. Conectar na VPS
ssh usuario@34.121.96.26

# 2. Dentro da VPS: puxar código novo e reiniciar
cd ~/tech-corretor
git pull origin main
sudo systemctl restart tech-corretor

# 3. Ver os logs ao vivo para confirmar que subiu
sudo journalctl -u tech-corretor -f
# Pressione Ctrl+C para sair dos logs
```

### Opção 2 — Tudo em uma linha (sem entrar no SSH)

```bash
ssh usuario@34.121.96.26 "cd ~/tech-corretor && git pull origin main && sudo systemctl restart tech-corretor && sudo journalctl -u tech-corretor -n 20"
```

> **Dica:** Substitua `usuario` pelo nome de usuário da sua VM (normalmente o mesmo da conta Google, ex: `rodrigo`).
> Para não precisar digitar senha toda vez, configure a chave SSH:
> ```bash
> ssh-copy-id usuario@34.121.96.26
> ```

### Ver status do serviço

```bash
ssh usuario@34.121.96.26 "sudo systemctl status tech-corretor"
```

### Reiniciar sem puxar código novo

```bash
ssh usuario@34.121.96.26 "sudo systemctl restart tech-corretor"
```

### Ver logs em tempo real

```bash
ssh usuario@34.121.96.26 "sudo journalctl -u tech-corretor -f"
```

---

## Deploy do site + builds (do Mac)

```bash
# Build macOS (DMG) + sobe tudo
./deploy.sh --mac

# Build Windows (EXE) + sobe tudo
./deploy.sh --win

# Só atualiza o site Firebase sem rebuild
./deploy.sh --site

# Pula o build, usa os arquivos existentes em dist/
./deploy.sh --skip-build
```

---

## Estrutura do projeto

```
corretor/
├── app.html          ← UI do painel (Electron + browser)
├── app.js            ← lógica frontend
├── auth.js           ← autenticação Firebase
├── firebase.js       ← configuração Firebase
├── server.js         ← backend Express + WhatsApp
├── main.js           ← processo principal Electron
├── style.css         ← estilos
├── package.json
├── deploy.sh         ← script de build e deploy
├── setup-gcloud.sh   ← instalação completa na VPS
├── setup-https.sh    ← configurar HTTPS + DuckDNS na VPS
└── public/
    ├── index.html    ← landing page (Firebase Hosting)
    └── download.html ← página de download DMG/EXE
```

---

## Configurar VPS do zero

```bash
# Rodar uma única vez após criar a VM no Google Cloud
curl -fsSL https://raw.githubusercontent.com/rodrigofcpereira/real-estate-agent/main/setup-gcloud.sh | bash
```

Após a instalação o serviço sobe automaticamente e reinicia com a VM.

## Manipular a VPS no terminal

gcloud compute ssh instance-20260701-143850 --zone=us-central1-b --command='sed -n "320,340p" /home/hybriduzapp/tech-corretor/node_modules/whatsapp-web.js/src/Client.js'

gcloud compute ssh instance-20260701-143850 --zone=us-central1-b --command='sudo journalctl -u tech-corretor -n 40 --no-pager'                                       

git add server.js && git commit -m "fix: não cacheia null no resolverNumero + timeout 25s na VPS + limpa cache ao desconectar" && git push origin main && ./update-vps.sh

## Site do APP
https://techcorretor.duckdns.org/