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
const antiBan = require("./anti-ban");

// ---- Evita que erros do Puppeteer/Chrome derrubem o processo ----
process.on("uncaughtException", (err) => {
  const ignore = ["TargetCloseError", "ProtocolError", "Target closed", "Session closed"];
  if (ignore.some(e => err?.message?.includes(e) || err?.name?.includes(e))) {
    logFile(`⚠️  Erro ignorado (Chrome fechou): ${err.message}`);
    return;
  }
  logFile(`💥 Erro não tratado: ${err.stack || err.message}`);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || String(reason);
  const ignore = ["TargetCloseError", "ProtocolError", "Target closed", "Session closed"];
  if (ignore.some(e => msg.includes(e))) {
    logFile(`⚠️  Rejeição ignorada (Chrome fechou): ${msg}`);
    return;
  }
  logFile(`💥 Rejeição não tratada: ${msg}`);
});

// ---- Log em arquivo para debug em produção ----
const LOG_FILE = path.join(
  process.env.WA_SESSION_PATH
    ? path.dirname(process.env.WA_SESSION_PATH)
    : path.join(__dirname, ".."),
  "wa_debug.log"
);
function logFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch(_) {}
}

// ---- Telemetria de erros (diagnóstico remoto) ----
// O backend Node não pode gravar direto no Firestore (não tem credencial de
// usuário nem é seguro embutir uma chave admin no instalador). Em vez disso,
// emite um evento via Socket.io — o frontend (já autenticado com a conta
// Firebase do corretor) recebe e grava na coleção "diagnosticos". Assim,
// qualquer erro relevante que acontecer na máquina do cliente aparece no seu
// Firebase Console, sem precisar pedir o wa_debug.log manualmente.
function emitirDiagnostico(tipo, dados = {}) {
  try {
    io.emit("diag:evento", { tipo, dados, timestamp: Date.now() });
  } catch (_) { /* socket pode não estar pronto ainda — não é crítico */ }
}

const ALLOWED_ORIGINS = [
  "https://tech-corretor.web.app",
  "https://tech-corretor.firebaseapp.com",
  "http://localhost:3000",
  /^http:\/\/localhost:\d+$/,   // Electron dev
];

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET","POST"], credentials: true }
});

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "50mb" })); // suporta imagens e vídeos em base64

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
let _foiPronto = false;       // true somente se o WA chegou ao estado "pronto" com sessão válida
let _prontoDesde = 0;         // timestamp de quando o WA ficou "pronto" (warm-up de getNumberId)

// ---- Versão do WhatsApp Web: usa o cache local mais recente ----
function resolverWebVersion() {
  const cachePath = path.join(__dirname, "..", ".wwebjs_cache");
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
  const sessionBase = process.env.WA_SESSION_PATH || path.join(__dirname, "..", ".wwebjs_auth");
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
        // "--headless=new" explícito: quando usamos executablePath customizado
        // (Chrome/Edge do sistema no Windows), o Puppeteer às vezes não consegue
        // detectar automaticamente a flag de headless correta para esse binário
        // e a opção `headless: true` sozinha é ignorada — o Chrome/Edge abre
        // então uma janela visível (em branco, pois roda sem UI própria).
        // Passar a flag manualmente garante que o navegador nunca fique visível.
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-ipc-flooding-protection",
        "--no-first-run",
        "--no-zygote",                               // evita processo zygote – boot mais rápido
        "--disable-background-timer-throttling",     // evita throttle de timers em segundo plano
        "--disable-renderer-backgrounding",          // mantém renderer ativo mesmo em background
        "--disable-backgrounding-occluded-windows",  // evita throttle de janelas ocultas
        "--renderer-process-limit=1",                // só 1 renderer → economiza ~100MB RAM
        "--disk-cache-size=52428800",                // cache de disco máx 50MB (padrão ~320MB)
        "--js-flags=--max-old-space-size=192",       // heap V8 máx 192MB (1GB VPS tem 193MB livres)
        // Fallback extra: caso algum flag conflitante force uma janela visível,
        // posiciona-a fora da área da tela para o usuário nunca vê-la.
        "--window-position=-32000,-32000",
      ],
      timeout: 300000,        // 5 min – VPS é lento no boot
      protocolTimeout: 300000 // 5 min – evita timeout em chamadas CDP longas
    };

    if (process.env.CHROMIUM_PATH) {
      puppeteerOpts.executablePath = process.env.CHROMIUM_PATH;
    } else {
      try {
        puppeteerOpts.executablePath = require('puppeteer').executablePath();
      } catch (_) {}
    }

    const isCloud = process.platform === "linux";

    clienteWA = new Client({
      authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH || "./.wwebjs_auth" }),
      puppeteer: puppeteerOpts,
      // authTimeoutMs: tempo que o Chromium tem para injetar o JS do WhatsApp Web
      // e2-micro é lento, 30s padrão é insuficiente → usa 300s na VPS
      authTimeoutMs: isCloud ? 300000 : 60000,
      // 'local' = salva o WhatsApp Web no disco e reutiliza → mais rápido
      webVersionCache: { type: "local" },
      userAgent: process.platform === "win32"
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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

      // VPS lento precisa de mais tempo — usa 300s em produção, 60s local
      const isCloud = !process.env.ELECTRON_RUN_AS_NODE && process.platform === "linux";
      const readyTimeoutMs = isCloud ? 300000 : 60000;

      // Se "ready" não disparar no tempo limite, tenta reconectar automaticamente (1 vez)
      clienteWA._readyTimeout = setTimeout(async () => {
        if (whatsappStatus !== "autenticado") return;

        if (_tentativasReconexao < 1) {
          _tentativasReconexao++;
          logFile(`⏱️ Timeout: 'ready' não disparou em ${readyTimeoutMs/1000}s. Reconectando automaticamente (tentativa ${_tentativasReconexao})...`);
          io.emit("wa:status", { status: "conectando", message: "Reconectando automaticamente..." });
          try { await destruirCliente(); } catch(_) {}
          iniciando = false;
          await iniciarWhatsApp();
        } else {
          // Segunda falha: sessão provavelmente expirada → limpa e pede novo QR
          _tentativasReconexao = 0;
          logFile("⏱️ Sessão expirada – limpando e aguardando novo QR Code...");
          io.emit("wa:status", { status: "conectando", message: "Sessão expirada. Limpando e gerando novo QR Code..." });
          try { await destruirCliente(); } catch(_) {}

          // Apaga dados de sessão para forçar novo QR
          const sessionPath = process.env.WA_SESSION_PATH || path.join(__dirname, "..", ".wwebjs_auth");
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logFile("🗑️  Sessão expirada apagada automaticamente.");
          }

          iniciando = false;
          await iniciarWhatsApp(); // vai gerar QR Code pois não há sessão
        }
      }, readyTimeoutMs);
    });

    clienteWA.on("ready", () => {
      console.log("🟢 WhatsApp pronto para enviar mensagens!");
      _tentativasReconexao = 0;
      _foiPronto = true; // sessão válida confirmada – permite auto-reconexão futura
      if (clienteWA && clienteWA._readyTimeout) {
        clearTimeout(clienteWA._readyTimeout);
        clienteWA._readyTimeout = null;
      }
      whatsappStatus = "pronto";
      _prontoDesde = Date.now(); // marca o instante para o warm-up de resolverNumero
      io.emit("wa:status", { status: "pronto" });
    });

    clienteWA.on("auth_failure", async (msg) => {
      console.error("❌ Falha na autenticação:", msg);
      emitirDiagnostico("auth_failure", { mensagem: msg });
      _tentativasReconexao = 0;
      whatsappStatus = "erro";
      io.emit("wa:status", { status: "erro", message: "Falha na autenticação. Tente novamente." });
      await destruirCliente();
    });

    clienteWA.on("disconnected", async (reason) => {
      console.warn("⚠️ WhatsApp desconectado:", reason);
      emitirDiagnostico("whatsapp_desconectado", { motivo: String(reason) });
      whatsappStatus = "desconectado";
      _cacheNumeros.clear(); // limpa cache ao desconectar para evitar dados velhos
      io.emit("wa:status", { status: "desconectado", message: reason });
      await destruirCliente();

      if (reason === "LOGOUT") {
        // Sessão revogada pelo celular – apaga arquivos locais para forçar novo QR
        _foiPronto = false;
        const sessionPath = process.env.WA_SESSION_PATH || path.join(__dirname, "..", ".wwebjs_auth");
        try {
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logFile("🗑️  Sessão LOGOUT apagada – aguardando novo QR Code via painel.");
          }
        } catch (_) {}
        io.emit("wa:status", { status: "erro", message: "Sessão encerrada no celular. Abra o painel e escaneie o QR Code." });
      } else if (process.platform === "linux" && !iniciando && _foiPronto) {
        // Só auto-reconecta se já teve sessão válida (estava "pronto").
        // Se nunca chegou a "pronto" (ex: só mostrou QR e caiu), aguarda ação do usuário.
        _foiPronto = false; // reseta para não lopar caso a reconexão também falhe
        logFile("🔄 Reconexão automática após desconexão temporária (aguarda 20s)...");
        setTimeout(() => {
          if (whatsappStatus === "desconectado" && !iniciando) {
            iniciarWhatsApp();
          }
        }, 20000);
      } else if (!_foiPronto) {
        // Caiu sem ter chegado a "pronto" – sem sessão ou QR não escaneado
        logFile("⚠️  Conexão encerrada sem sessão válida – aguardando ação do usuário.");
        io.emit("wa:status", { status: "erro", message: "Falha ao conectar. Clique em 'Conectar WhatsApp' para tentar novamente." });
      }
    });

    await clienteWA.initialize();

  } catch (err) {
    logFile(`❌ Erro ao iniciar WhatsApp: ${err.message}`);
    logFile(`   STACK: ${err.stack}`);
    logFile(`   CHROMIUM_PATH: ${process.env.CHROMIUM_PATH || "(não definido)"}`);
    emitirDiagnostico("falha_iniciar_whatsapp", {
      erro: err.message,
      chromiumPath: process.env.CHROMIUM_PATH || "(não definido)",
      plataforma: process.platform,
    });
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
  socket.emit("anti-ban:status", antiBan.getStatus());

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
// Cache de números já verificados para não consultar o WhatsApp toda vez
const _cacheNumeros = new Map(); // "5511..." → { chatId, numero } — só guarda sucessos

// Timeout para getNumberId: VPS lenta precisa de mais tempo
const NUMERO_TIMEOUT_MS = process.platform === "linux" ? 60000 : 12000;

async function resolverNumero(telefone) {
  // Remove tudo que não é dígito
  let numero = telefone.replace(/\D/g, "");

  // Garante DDI 55 (Brasil)
  if (!numero.startsWith("55")) numero = "55" + numero;

  // Verifica cache primeiro (só tem entradas bem-sucedidas)
  if (_cacheNumeros.has(numero)) {
    const cached = _cacheNumeros.get(numero);
    logFile(`📋 Cache: ${numero} → encontrado (${cached.chatId})`);
    return cached;
  }

  // ── Warm-up: nos primeiros segundos após "ready", o getNumberId pode
  // retornar falso-negativo (null) mesmo para números válidos, porque o
  // WhatsApp Web ainda está sincronizando o índice de contatos internamente.
  // Damos mais tentativas e mais tempo de espera nesse período inicial.
  const msDesdePronto = _prontoDesde ? Date.now() - _prontoDesde : Infinity;
  const emWarmup = msDesdePronto < 45000; // primeiros 45s após "pronto"
  const maxTentativas = emWarmup ? 4 : 2;
  const esperaEntreTentativas = emWarmup ? 8000 : 5000;

  // Tenta número normal e também sem o 9 extra (regiões antigas)
  const candidatos = [numero];
  if (numero.length === 13 && numero[4] === "9") {
    candidatos.push(numero.slice(0, 4) + numero.slice(5));
  }
  // Também tenta adicionar o 9 extra, caso o cliente tenha cadastrado sem ele
  if (numero.length === 12) {
    candidatos.push(numero.slice(0, 4) + "9" + numero.slice(4));
  }

  // Histórico de tentativas — usado para telemetria caso o número não seja resolvido
  const historicoTentativas = [];

  for (const candidato of candidatos) {
    let nuloDefinitivo = false;
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      try {
        const numberId = await Promise.race([
          clienteWA.getNumberId(candidato),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NUMERO_TIMEOUT_MS))
        ]);
        if (numberId) {
          const resultado = { chatId: numberId._serialized, numero: candidato };
          _cacheNumeros.set(numero, resultado);
          return resultado;
        }
        logFile(`⚠️  getNumberId retornou null para ${candidato} (tentativa ${tentativa}/${maxTentativas}${emWarmup ? ", em warm-up" : ""})`);
        historicoTentativas.push({ candidato, tentativa, resultado: "null" });
        // Durante o warm-up, um "null" pode ser falso-negativo → tenta de novo.
        // Fora do warm-up, confia no resultado (número realmente não existe).
        if (!emWarmup) { nuloDefinitivo = true; break; }
        if (tentativa < maxTentativas) {
          await new Promise(r => setTimeout(r, esperaEntreTentativas));
        }
      } catch (err) {
        if (err.message === "timeout") {
          logFile(`⚠️  Timeout (${NUMERO_TIMEOUT_MS/1000}s) ao verificar ${candidato} — tentativa ${tentativa}/${maxTentativas}`);
          historicoTentativas.push({ candidato, tentativa, resultado: "timeout" });
          if (tentativa < maxTentativas) {
            await new Promise(r => setTimeout(r, esperaEntreTentativas));
          }
        } else {
          logFile(`⚠️  Erro ao verificar ${candidato}: ${err.message}`);
          historicoTentativas.push({ candidato, tentativa, resultado: "erro", erro: err.message });
          break;
        }
      }
    }
    if (nuloDefinitivo) break;
  }

  logFile(`❌ Número ${numero} não encontrado no WhatsApp`);
  emitirDiagnostico("numero_nao_encontrado", {
    numeroOriginal: telefone,
    numeroNormalizado: numero,
    candidatosTestados: candidatos,
    emWarmup,
    msDesdePronto: _prontoDesde ? Date.now() - _prontoDesde : null,
    historicoTentativas,
    plataforma: process.platform,
  });
  return null;
}

// ---- Utilitário: construir MessageMedia a partir de dataURL base64 ou URL HTTPS ----
function dataURLparaMedia(dataURL, nomeArquivo = "imovel.jpg") {
  // Formato esperado: "data:<mimetype>;base64,<dados>"
  const match = dataURL.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return new MessageMedia(match[1], match[2], nomeArquivo);
}

// Suporta tanto data URLs (base64) quanto URLs HTTPS do Firebase Storage
// nomeArquivo = null → detecta automaticamente a extensão pelo mime type
async function processarMedia(fotoInput, nomeArquivo = null) {
  if (typeof fotoInput !== 'string' || !fotoInput) return null;

  // URL HTTPS → baixa o arquivo e converte para MessageMedia
  if (fotoInput.startsWith('http')) {
    try {
      const media = await MessageMedia.fromUrl(fotoInput, { unsafeMime: true });
      if (media && nomeArquivo) media.filename = nomeArquivo;
      return media;
    } catch(e) {
      logFile(`⚠️ Falha ao baixar mídia via URL (${nomeArquivo || fotoInput}): ${e.message}`);
      return null;
    }
  }

  // data URL base64 → detecta mime type e gera nome de arquivo adequado
  const match = fotoInput.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimetype = match[1];
  if (!nomeArquivo) {
    // ex: "image/jpeg" → "imovel.jpg", "video/mp4" → "imovel.mp4"
    const ext = mimetype.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    nomeArquivo = `midia_${Date.now()}.${ext}`;
  }
  return new MessageMedia(mimetype, match[2], nomeArquivo);
}

// ---- API: Enviar mensagem ----
app.post("/api/send", async (req, res) => {
  const { telefone, mensagem, midias } = req.body;

  const midiasArray = Array.isArray(midias) ? midias : (midias ? [midias] : []);

  if (!telefone || (!mensagem && midiasArray.length === 0)) {
    return res.status(400).json({ ok: false, erro: "telefone e mensagem (ou mídia) são obrigatórios" });
  }
  if (!clienteWA || whatsappStatus !== "pronto") {
    return res.status(503).json({ ok: false, erro: "WhatsApp não está conectado" });
  }

  // ── Anti-ban: verificar se pode enviar ──
  const verificacao = antiBan.podeEnviar();
  if (!verificacao.permitido) {
    return res.status(429).json({ ok: false, erro: verificacao.motivo });
  }

  const resolvido = await resolverNumero(telefone);
  if (!resolvido) {
    return res.status(404).json({ ok: false, erro: `Número ${telefone} não encontrado no WhatsApp` });
  }

  // Pré-converte mídias (suporta data URL base64 e URL HTTPS – imagens e vídeos)
  const mediasRaw = await Promise.all(midiasArray.map((m) => processarMedia(m, null)));
  const medias = mediasRaw.filter(Boolean);

  try {
    // ── Anti-ban: simular digitação antes de enviar ──
    await antiBan.simularDigitacao(clienteWA, resolvido.chatId);

    // ── Anti-ban: variar texto para não repetir mensagens idênticas ──
    const mensagemFinal = antiBan.variarTexto(mensagem);

    if (medias.length === 0) {
      await clienteWA.sendMessage(resolvido.chatId, mensagemFinal);
    } else if (medias.length === 1) {
      await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: mensagemFinal || "" });
    } else {
      await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: mensagemFinal || "" });
      for (let i = 1; i < medias.length; i++) {
        await antiBan.sleep(antiBan.delayHumanizado(1500, 3000)); // delay entre mídias
        await clienteWA.sendMessage(resolvido.chatId, medias[i]);
      }
    }

    // ── Anti-ban: registrar envio nos contadores ──
    antiBan.registrarEnvio();

    console.log(`📤 Mensagem enviada para ${resolvido.numero} (${medias.length} mídia(s))`);
    res.json({ ok: true, numero: resolvido.numero });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.message);
    emitirDiagnostico("falha_envio_individual", {
      numero: resolvido.numero,
      erro: err.message,
      temMidia: medias.length > 0,
    });
    res.status(500).json({ ok: false, erro: `Falha ao enviar: ${err.message}` });
  }
});

// ---- Jobs de disparo em lote (processados em background, com progresso via Socket.io) ----
// Um Map simples é suficiente aqui: só roda um processo Node por instância,
// e cada usuário do painel local dispara um lote por vez.
const _batchJobs = new Map(); // jobId → { cancelado: boolean }

function gerarJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Processa o lote inteiro em background, emitindo eventos de progresso.
// Nunca aborta o lote por causa de limite de hora/dia — em vez disso PAUSA
// e avisa o usuário (via evento) até poder continuar, ou até esgotar o
// limite diário (aí sim marca o restante como pendente e encerra o job).
async function processarLoteBackground(jobId, mensagens, medias) {
  const jobState = _batchJobs.get(jobId);
  const resultados = [];
  const total = mensagens.length;

  const emitProgresso = (extra = {}) => {
    io.emit("disparo:progresso", {
      jobId,
      total,
      enviados: resultados.filter(r => r.ok).length,
      erros: resultados.filter(r => !r.ok).length,
      processados: resultados.length,
      ...extra,
    });
  };

  for (let idx = 0; idx < total; idx++) {
    if (jobState?.cancelado) {
      for (let j = idx; j < total; j++) {
        resultados.push({ numero: mensagens[j].telefone, ok: false, erro: "Cancelado pelo usuário" });
      }
      emitProgresso({ status: "cancelado" });
      break;
    }

    const item = mensagens[idx];

    // ── Anti-ban: se bateu limite de hora, PAUSA e avisa — não aborta ──
    const podeAgora = antiBan.podeEnviar();
    if (!podeAgora.permitido) {
      if (podeAgora.aguardarMs === null) {
        // Limite diário ou fora do horário comercial: não compensa esperar.
        // Marca o restante como pendente (não erro definitivo) e encerra o job.
        for (let j = idx; j < total; j++) {
          resultados.push({ numero: mensagens[j].telefone, ok: false, erro: podeAgora.motivo, pendente: true });
        }
        emitProgresso({ status: "pausado_definitivo", motivo: podeAgora.motivo });
        break;
      }

      emitProgresso({ status: "aguardando_limite", motivo: podeAgora.motivo, aguardarMs: podeAgora.aguardarMs });
      await antiBan.esperarLiberar((info) => {
        if (jobState?.cancelado) return;
        emitProgresso({ status: "aguardando_limite", motivo: info.motivo, aguardarMs: info.aguardarMs });
      });
      if (jobState?.cancelado) continue; // volta ao topo do for, que vai tratar o cancelamento
    }

    let resolvido = null;
    try {
      emitProgresso({ status: "verificando_numero", clienteAtual: item.nome || item.telefone });
      resolvido = await resolverNumero(item.telefone || "");
    } catch (err) {
      resultados.push({ numero: item.telefone, ok: false, erro: "Erro ao verificar número" });
      emitProgresso();
      continue;
    }

    if (!resolvido) {
      resultados.push({
        numero: item.telefone,
        ok: false,
        erro: `Número não registrado no WhatsApp (${item.telefone})`
      });
      emitProgresso();
      continue;
    }

    try {
      emitProgresso({ status: "enviando", clienteAtual: item.nome || resolvido.numero });

      // ── Anti-ban: simular digitação ──
      await antiBan.simularDigitacao(clienteWA, resolvido.chatId);

      // ── Anti-ban: variar texto para evitar mensagens idênticas ──
      const mensagemFinal = antiBan.variarTexto(item.mensagem);

      if (medias.length === 0) {
        await clienteWA.sendMessage(resolvido.chatId, mensagemFinal);
      } else if (medias.length === 1) {
        await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: mensagemFinal });
      } else {
        await clienteWA.sendMessage(resolvido.chatId, medias[0], { caption: mensagemFinal });
        for (let i = 1; i < medias.length; i++) {
          await antiBan.sleep(antiBan.delayHumanizado(1500, 3000)); // delay entre mídias
          await clienteWA.sendMessage(resolvido.chatId, medias[i]);
        }
      }

      // ── Anti-ban: registrar envio ──
      antiBan.registrarEnvio();

      console.log(`📤 Enviado → ${resolvido.numero} (${medias.length} foto(s))`);
      resultados.push({ numero: resolvido.numero, ok: true });
    } catch (err) {
      console.error(`❌ Falha → ${resolvido.numero}:`, err.message);
      resultados.push({ numero: resolvido.numero, ok: false, erro: `Falha no envio: ${err.message}` });
      emitirDiagnostico("falha_envio_lote", {
        jobId,
        numero: resolvido.numero,
        erro: err.message,
        temMidia: medias.length > 0,
        posicaoNoLote: idx,
        totalLote: total,
      });
    }

    emitProgresso();

    // ── Anti-ban: delay humanizado entre destinatários ──
    if (idx < total - 1) {
      const delay = antiBan.calcularDelay();
      logFile(`⏳ Anti-ban: aguardando ${(delay / 1000).toFixed(1)}s antes do próximo envio...`);
      emitProgresso({ status: "pausa_curta", aguardarMs: delay });
      await antiBan.sleep(delay);
    }
  }

  const qtdOk  = resultados.filter(r => r.ok).length;
  const qtdErr = resultados.filter(r => !r.ok).length;
  console.log(`✅ Lote concluído: ${qtdOk} enviados, ${qtdErr} com erro`);

  io.emit("disparo:concluido", { jobId, resultados, qtdOk, qtdErr });
  _batchJobs.delete(jobId);
}

// ---- API: Enviar mensagens em lote (inicia job em background, retorna jobId imediatamente) ----
app.post("/api/send-batch", async (req, res) => {
  const { mensagens, fotos } = req.body;   // fotos = array de dataURL base64 (opcional)

  if (!mensagens || !Array.isArray(mensagens)) {
    return res.status(400).json({ ok: false, erro: "mensagens deve ser um array" });
  }
  if (!clienteWA || whatsappStatus !== "pronto") {
    return res.status(503).json({ ok: false, erro: "WhatsApp não está conectado" });
  }

  // ── Anti-ban: só bloqueia de início se for horário/dia (não compensa nem começar) ──
  const verificacao = antiBan.podeEnviar();
  if (!verificacao.permitido && verificacao.aguardarMs === null) {
    return res.status(429).json({ ok: false, erro: verificacao.motivo });
  }

  // Pré-converte todas as mídias uma única vez (suporta data URL e HTTPS)
  const fotosArray = Array.isArray(fotos) ? fotos : (fotos ? [fotos] : []);
  const mediasRaw = await Promise.all(
    fotosArray.map((f, i) => processarMedia(f, `imovel_${i + 1}.jpg`))
  );
  const medias = mediasRaw.filter(Boolean);

  const jobId = gerarJobId();
  _batchJobs.set(jobId, { cancelado: false });

  // Responde IMEDIATAMENTE com o jobId — o front acompanha o progresso via
  // socket ("disparo:progresso" / "disparo:concluido"), sem depender de uma
  // única requisição HTTP longa que trava a UI por minutos/horas.
  res.json({ ok: true, jobId, total: mensagens.length });

  // Processa em background (não bloqueia a resposta HTTP acima)
  processarLoteBackground(jobId, mensagens, medias).catch(err => {
    logFile(`💥 Erro no job de disparo ${jobId}: ${err.message}`);
    emitirDiagnostico("falha_job_disparo", { jobId, erro: err.message, totalMensagens: mensagens.length });
    io.emit("disparo:concluido", { jobId, erro: err.message });
    _batchJobs.delete(jobId);
  });
});

// ---- API: Cancelar um disparo em andamento ----
app.post("/api/send-batch/:jobId/cancelar", (req, res) => {
  const job = _batchJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, erro: "Job não encontrado (já concluído ou inválido)" });
  }
  job.cancelado = true;
  res.json({ ok: true });
});

// ---- API: Status do anti-ban (monitorar limites no frontend) ----
app.get("/api/anti-ban/status", (req, res) => {
  res.json({ ok: true, ...antiBan.getStatus() });
});

// ---- API: Configurar anti-ban em tempo de execução ----
app.post("/api/anti-ban/config", (req, res) => {
  const campos = req.body;
  if (!campos || typeof campos !== "object") {
    return res.status(400).json({ ok: false, erro: "Body deve ser um objeto com os campos a atualizar" });
  }
  antiBan.atualizarConfig(campos);
  res.json({ ok: true, config: antiBan.getConfig() });
});

// ---- API: Liga/desliga o anti-ban (switch do dashboard) ----
app.post("/api/anti-ban/toggle", (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== "boolean") {
    return res.status(400).json({ ok: false, erro: "campo 'ativo' (boolean) é obrigatório" });
  }
  antiBan.setAtivo(ativo);
  logFile(`🛡️  Anti-ban ${ativo ? "ATIVADO" : "DESATIVADO"} pelo usuário via dashboard.`);
  const status = antiBan.getStatus();
  // Avisa todos os clientes conectados (outras abas/dispositivos) da mudança
  io.emit("anti-ban:status", status);
  res.json({ ok: true, ...status });
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
  const sessionPath = process.env.WA_SESSION_PATH || path.join(__dirname, "..", ".wwebjs_auth");
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

  // ── Auto-reconectar WhatsApp se já existe sessão salva ──────────────────
  // Comportamento idêntico ao da VPS: o servidor sempre tenta reconectar
  // automaticamente ao iniciar, sem precisar que o frontend acione o botão.
  // Só inicia se houver pasta de sessão com conteúdo (evita QR desnecessário).
  const sessionBase = process.env.WA_SESSION_PATH || path.join(__dirname, "..", ".wwebjs_auth");
  let temSessao = false;
  try {
    if (fs.existsSync(sessionBase)) {
      temSessao = fs.readdirSync(sessionBase).length > 0;
    }
  } catch (_) {}

  if (temSessao) {
    logFile("🔄 Sessão encontrada – reconectando WhatsApp automaticamente...");
    // Pequeno delay para o servidor terminar de subir antes de abrir o Chrome
    setTimeout(() => iniciarWhatsApp(), 3000);
  } else {
    logFile("ℹ️  Nenhuma sessão encontrada – aguardando conexão manual.");
  }
});
