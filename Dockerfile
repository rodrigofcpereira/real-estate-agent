FROM node:20-slim

# Instala Chromium e dependências do whatsapp-web.js
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    libxshmfence1 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Cria diretório da sessão WhatsApp com permissão
RUN mkdir -p .wwebjs_auth && chmod 777 .wwebjs_auth

EXPOSE 3000

CMD ["node", "server.js"]
