// =============================================
//  Tech Corretor – server.js
//  Backend WhatsApp Web via whatsapp-web.js
// =============================================

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const path       = require("path");
const fs         = require("fs");
const qrcode     = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// ---- Log em arquivo para debug em produção ----
const LOG_FILE = path.join(
  process.env.WA_SESSION_PATH
    ? path.dirname(process.env.WA_SESSION_PATH)
    : __dirname,
  "wa_debug.log"
);
function logFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch(_) {}
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "20mb" })); // suporta imagens em base64

// Servir o app local (app.html como raiz)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

// Servir os arquivos estáticos do frontend
app.use(express.static(path.join(__dirname)));

// ---- Estado do WhatsApp ----
let whatsappStatus = "desconectado"; // desconectado | qr | autenticado | pronto | erro
let clienteWA      = null;
let iniciando      = false; // trava para evitar chamadas simultâneas
let _tentativasReconexao = 0; // contador de retentativas automáticas

// ---- Versão do WhatsApp Web: usa o cache local mais recente ----
function resolverWebVersion() {
  const cachePath = path.join(__dirname, ".wwebjs_cache");
  try {
    if (fs.existsSync(cachePath)) {
      const arquivos = fs.readdirSync(cachePath)
        .filter(f => f.endsWith(".html"))
        .sort(); // ordenação lexicográfica – a última é a mais recente
      if (arquivos.length > 0) {
        const versao = arquivos[arquivos.length - 1].replace(".html", "");
        logFile(`📦 Usando webVersion do cache local: ${versao}`);
        return versao;
      }
    }
  } catch (_) {}
  // fallback para uma versão recente conhecida
  logFile("📦 Cache não encontrado – usando webVersion fallback: 2.3000.1042462245");
  return "2.3000.1042462245";
}

// ---- Limpar arquivos de lock do Chrome (evita trava entre execuções) ----
function limparLockChrome() {
  const sessionBase = process.env.WA_SESSION_PATH || path.join(__dirname, ".wwebjs_auth");
  const lockFiles   = ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"];

  function removerLocks(dir) {
    if (!fs.existsSync(dir)) return;
    lockFiles.forEach(nome => {
      const p = path.join(dir, nome);
      try {
        if (fs.existsSync(p) || fs.lstatSync(p)) {
          fs.unlinkSync(p);
          logFile(`🗑️  Lock removido: ${p}`);
        }
      } catch (_) {}
    });
    // percorre subdiretórios (ex: session/, session-0/, …)
    try {
      fs.readdirSync(dir).forEach(sub => {
        const subPath = path.join(dir, sub);
        try {
          if (fs.lstatSync(subPath).isDirectory()) removerLocks(subPath);
        } catch (_) {}
      });
    } catch (_) {}
  }

  removerLocks(sessionBase);
}

// ---- Destruir cliente atual e aguardar o browser fechar ----
async function destruirCliente() {
  if (!clienteWA) return;
  const alvo = clienteWA;
  clienteWA  = null;
  if (alvo._readyTimeout) { clearTimeout(alvo._readyTimeout); alvo._readyTimeout = null; }
  try { await alvo.destroy(); } catch(e) { /* ignora erros de destruição */ }
  // Aguarda o Puppeteer liberar o lock do userDataDir
  await new Promise(r => setTimeout(r, 1200));
  limparLockChrome(); // remove locks stale após o browser fechar
}

// ---- Inicializar cliente WhatsApp ----
async function iniciarWhatsApp() {
  if (iniciando) {
    console.warn("⚠️  iniciarWhatsApp já está em andamento, ignorando chamada duplicada.");
    return;
  }
  iniciando = true;

  try {
    await destruirCliente();

    // Remove locks stale ANTES de abrir o Chrome (evita travamento na primeira execução)
    limparLockChrome();

    whatsappStatus = "conectando";
    io.emit("wa:status", { status: "conectando" });

    const puppeteerOpts = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-zygote",
        "--disable-extensions",
        "--disable-background-networking"
      ]
    };

    if (process.env.CHROMIUM_PATH) {
      puppeteerOpts.executablePath = process.env.CHROMIUM_PATH;
    } else {
      try {
        puppeteerOpts.executablePath = require('puppeteer').executablePath();
      } catch (_) {}
    }

    clienteWA = new Client({
      authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH || "./.wwebjs_auth" }),
      puppeteer: puppeteerOpts,
      webVersionCache: { type: "none" },  // sempre baixa a versão atual do WhatsApp Web
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    clienteWA.on("qr", async (qr) => {
      console.log("📱 QR Code gerado – escaneie com o WhatsApp!");
      _tentativasReconexao = 0; // QR gerado = nova sessão, zera contador
      whatsappStatus = "qr";
      try {
        const qrDataURL = await qrcode.toDataURL(qr, { width: 280, margin: 2 });
        io.emit("wa:qr", { qr: qrDataURL });
        io.emit("wa:status", { status: "qr" });
      } catch (err) {
        console.error("Erro ao gerar QR:", err);
      }
    });

    clienteWA.on("loading_screen", (percent, message) => {
      io.emit("wa:status", { status: "conectando", message: `${message} (${percent}%)` });
    });

    clienteWA.on("authenticated", () => {
      console.log("✅ WhatsApp autenticado!");
      whatsappStatus = "autenticado";
      io.emit("wa:status", { status: "autenticado", message: "Sessão autenticada, carregando WhatsApp..." });

      // Se "ready" não disparar em 45s, tenta reconectar automaticamente (1 vez)
      clienteWA._readyTimeout = setTimeout(async () => {
        if (whatsappStatus !== "autenticado") return;

        if (_tentativasReconexao < 1) {
          _tentativasReconexao++;
          logFile(`⏱️ Timeout: 'ready' não disparou em 45s. Reconectando automaticamente (tentativa ${_tentativasReconexao})...`);
          io.emit("wa:status", { status: "conectando", message: "Reconectando automaticamente..." });
          await destruirCliente();
          iniciando = false;
          await iniciarWhatsApp();
        } else {
          // Segunda falha: sessão provavelmente expirada → limpa e pede novo QR
          _tentativasReconexao = 0;
          logFile("⏱️ Sessão expirada – limpando e aguardando novo QR Code...");
          io.emit("wa:status", { status: "conectando", message: "Sessão expirada. Limpando e gerando novo QR Code..." });
          await destruirCliente();

          // Apaga dados de sessão para forçar novo QR
          const sessionPath = process.env.WA_SESSION_PATH || path.join(__dirname, ".wwebjs_auth");
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logFile("🗑️  Sessão expirada apagada automaticamente.");
          }

          iniciando = false;
          await iniciarWhatsApp(); // vai gerar QR Code pois não há sessão
        }
      }, 45000);
    });

    clienteWA.on("ready", () => {
      console.log("🟢 WhatsApp pronto para enviar mensagens!");
      _tentativasReconexao = 0;
      if (clienteWA && clienteWA._readyTimeout) {
        clearTimeout(clienteWA._readyTimeout);
        clienteWA._readyTimeout = null;
      }
      whatsappStatus = "pronto";
      io.emit("wa:status", { status: "pronto" });
    });

    clienteWA.on("auth_failure", async (msg) => {
      console.error("❌ Falha na autenticação:", msg);
      _tentativasReconexao = 0;
      whatsappStatus = "erro";
      io.emit("wa:status", { status: "erro", message: "Falha na autenticação. Tente novamente." });
      await destruirCliente();
    });

    clienteWA.on("disconnected", async (reason) => {
      console.warn("⚠️ WhatsApp desconectado:", reason);
      whatsappStatus = "desconectado";
      io.emit("wa:status", { status: "desconectado", message: reason });
      await destruirCliente();
    });

    await clienteWA.initialize();

  } catch (err) {
    logFile(`❌ Erro ao iniciar WhatsApp: ${err.message}`);
    logFile(`   STACK: ${err.stack}`);
    logFile(`   CHROMIUM_PATH: ${process.env.CHROMIUM_PATH || "(não definido)"}`);
    whatsappStatus = "erro";
    io.emit("wa:status", { status: "erro", message: "Erro ao iniciar. Tente novamente." });
    await destruirCliente();
  } finally {
    iniciando = false;
  }
}

// ---- Socket.io ----
io.on("connection", (socket) => {
  console.log("🔌 Cliente conectado:", socket.id);

  // Envia status atual para o novo cliente
  socket.emit("wa:status", { status: whatsappStatus });

  socket.on("wa:iniciar", () => {
    console.log("▶️ Solicitação para iniciar WhatsApp");
    iniciarWhatsApp();
  });

  socket.on("wa:desconectar", async () => {
    if (clienteWA) {
      try { await clienteWA.logout(); } catch(e) {}
    }
    await destruirCliente();
    whatsappStatus = "desconectado";
    io.emit("wa:status", { status: "desconectado" });
    console.log("🔴 WhatsApp desconectado pelo usuário");
  });

  socket.on("disconnect", () => {
    console.log("🔌 Cliente desconectado:", socket.id);
  });
});

// ---- Utilitário: formatar e validar número ----
async function resolverNumero(telefone) {
  // Remove tudo que não é dígito
  let numero = telefone.replace(/\D/g, "");

  // Garante DDI 55 (Brasil)
  if (!numero.startsWith("55")) numero = "55" + numero;

  // Tenta número normal (ex: 5581999999999)
  // e também versão sem o 9 extra (para fixos e regiões antigas)
  const candidatos = [numero];
  if (numero.length === 13 && numero[4] === "9") {
    // 5581 9XXXX-XXXX → tenta também 5581 XXXX-XXXX
    candidatos.push(numero.slice(0, 4) + numero.slice(5));
  }

  for (const candidato of candidatos) {
    try {
      const numberId = await clienteWA.getNumberId(candidato);
      if (numberId) return { chatId: numberId._serialized, numero: candidato };
    } catch (_) {}
  }

  return null; // número não encontrado no WhatsApp
}

// ---- Utilitário: construir MessageMedia a partir de dataURL base64 ----
function dataURLparaMedia(dataURL, nomeArquivo = "imovel.jpg") {
  // Formato esperado: "data:<mimetype>;base64,<dados>"
  const match = dataURL.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return new MessageMedia(match[1], match[2], nomeArquivo);
}

// ---- API: Enviar mensagem ----
app.post("/api/send", async (req, res) => {
  const { telefone, mensagem } = req.body;

  if (!telefone || !mensagem) {
    return res.status(400).json({ ok: false, erro: "telefone e mensagem são obrigatórios" });
  }
  if (!clienteWA || whatsappStatus !== "pronto") {
    return res.status(503).json({ ok: false, erro: "WhatsApp não está conectado" });
  }

  const resolvido = await resolverNumero(telefone);
  if (!resolvido) {
    return res.status(404).json({ ok: false, erro: `Número ${telefone} não encontrado no WhatsApp` });
  }

  try {
    await clienteWA.sendMessage(resolvido.chatId, mensagem);
    console.log(`📤 Mensagem enviada para ${resolvido.numero}`);
    res.json({ ok: true, numero: resolvido.numero });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.message);
    res.status(500).json({ ok: false, erro: `Falha ao enviar: ${err.message}` });
  }
});

// ---- API: Enviar mensagens em lote ----
app.post("/api/send-batch", async (req, res) => {
  const { mensagens, fotos } = req.body;   // fotos = array de dataURL base64 (opcional)

  if (!mensagens || !Array.isArray(mensagens)) {
    return res.status(400).json({ ok: false, erro: "mensagens deve ser um array" });
  }
  if (!clienteWA || whatsappStatus !== "pronto") {
    return res.status(503).json({ ok: false, erro: "WhatsApp não está conectado" });
  }

  // Pré-converte todas as mídias uma única vez
  const fotosArray = Array.isArray(fotos) ? fotos : (fotos ? [fotos] : []);
  const medias = fotosArray
    .map((f, i) => dataURLparaMedia(f, `imovel_${i + 1}.jpg`))
    .filter(Boolean);

  // Dispara todos em paralelo
  const promessas = mensagens.map(async (item) => {
    let resolvido = null;
    try {
      resolvido = await resolverNumero(item.telefone || "");
    } catch (err) {
      return { numero: item.telefone, ok: false, erro: "Erro ao verificar número" };
    }

    if (!resolvido) {
      return {
        numero: item.telefone,
        ok: false,
        erro: `Número não registrado no WhatsApp (${item.telefone})`
      };
    }

    try {
      if (medias.length === 0) {
        // Só texto
        await clienteWA.sendMessage(resolvido.chatId, item.mensagem);
      } else if (medias.length === 1) {
        // Uma foto com legenda
        await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: item.mensagem });
      } else {
        // Primeira foto com legenda
        await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: item.mensagem });
        // Demais fotos como galeria (sem legenda, em sequência)
        for (let i = 1; i < medias.length; i++) {
          await clienteWA.sendMessage(resolvido.chatId, medias[i]);
        }
      }
      console.log(`📤 Enviado → ${resolvido.numero} (${medias.length} foto(s))`);
      return { numero: resolvido.numero, ok: true };
    } catch (err) {
      console.error(`❌ Falha → ${resolvido.numero}:`, err.message);
      return { numero: resolvido.numero, ok: false, erro: `Falha no envio: ${err.message}` };
    }
  });

  const resultados = await Promise.all(promessas);

  const qtdOk  = resultados.filter(r => r.ok).length;
  const qtdErr = resultados.filter(r => !r.ok).length;
  console.log(`✅ Lote concluído: ${qtdOk} enviados, ${qtdErr} com erro`);

  res.json({ ok: true, resultados });
});

// ---- API: Limpar sessão (use quando 'ready' nunca dispara) ----
app.post("/api/limpar-sessao", async (req, res) => {
  if (clienteWA) {
    try { await clienteWA.logout(); } catch(e) {}
  }
  await destruirCliente();
  iniciando = false; // libera a trava caso tenha ficado presa
  _tentativasReconexao = 0;

  // Apaga os dados de sessão do LocalAuth
  const sessionPath = process.env.WA_SESSION_PATH || path.join(__dirname, ".wwebjs_auth");
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log("🗑️  Sessão apagada com sucesso.");
  }
  whatsappStatus = "desconectado";
  io.emit("wa:status", { status: "desconectado", message: "Sessão limpa. Reconecte para gerar novo QR Code." });
  res.json({ ok: true });
});

// ---- API: Status ----
app.get("/api/status", (req, res) => {
  res.json({ status: whatsappStatus });
});

// ---- API: Iniciar WhatsApp (para testes via HTTP) ----
app.post("/api/iniciar", (req, res) => {
  logFile("▶️ /api/iniciar chamado via HTTP");
  iniciarWhatsApp();
  res.json({ ok: true, message: "Iniciando..." });
});

// ---- Iniciar servidor ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  limparLockChrome(); // garante que não há locks stale da execução anterior
  console.log(`\n🚀 Servidor Tech Corretor rodando em http://localhost:${PORT}`);
  console.log("📋 Abra o navegador e use o painel normalmente.");
  console.log("📱 Clique em 'Conectar WhatsApp' para escanear o QR Code.\n");
});
