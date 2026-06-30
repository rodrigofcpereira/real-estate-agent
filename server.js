// =============================================
//  LF Imóveis – server.js
//  Backend WhatsApp Web via whatsapp-web.js
// =============================================

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const path       = require("path");
const qrcode     = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

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

// ---- Destruir cliente atual e aguardar o browser fechar ----
async function destruirCliente() {
  if (!clienteWA) return;
  const alvo = clienteWA;
  clienteWA  = null;
  if (alvo._readyTimeout) { clearTimeout(alvo._readyTimeout); alvo._readyTimeout = null; }
  try { await alvo.destroy(); } catch(e) { /* ignora erros de destruição */ }
  // Aguarda um tick para o Puppeteer liberar o lock do userDataDir
  await new Promise(r => setTimeout(r, 800));
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

    whatsappStatus = "conectando";
    io.emit("wa:status", { status: "conectando" });

    const puppeteerOpts = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu"
      ]
    };

    if (process.env.CHROMIUM_PATH) {
      puppeteerOpts.executablePath = process.env.CHROMIUM_PATH;
    }

    clienteWA = new Client({
      authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH || "./.wwebjs_auth" }),
      puppeteer: puppeteerOpts
    });

    clienteWA.on("qr", async (qr) => {
      console.log("📱 QR Code gerado – escaneie com o WhatsApp!");
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

      // Se "ready" não disparar em 90s, a sessão está corrompida
      clienteWA._readyTimeout = setTimeout(async () => {
        if (whatsappStatus === "autenticado") {
          console.error("⏱️ Timeout: 'ready' não disparou em 90s. Sessão pode estar corrompida.");
          whatsappStatus = "erro";
          io.emit("wa:status", { status: "erro", message: "Sessão corrompida. Clique em 'Limpar Sessão' e reconecte." });
          await destruirCliente();
        }
      }, 90000);
    });

    clienteWA.on("ready", () => {
      console.log("🟢 WhatsApp pronto para enviar mensagens!");
      if (clienteWA && clienteWA._readyTimeout) {
        clearTimeout(clienteWA._readyTimeout);
        clienteWA._readyTimeout = null;
      }
      whatsappStatus = "pronto";
      io.emit("wa:status", { status: "pronto" });
    });

    clienteWA.on("auth_failure", async (msg) => {
      console.error("❌ Falha na autenticação:", msg);
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
    console.error("❌ Erro ao iniciar WhatsApp:", err.message);
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

  // Apaga os dados de sessão do LocalAuth
  const fs    = require("fs");
  const path2 = require("path");
  const sessionPath = process.env.WA_SESSION_PATH || path2.join(__dirname, ".wwebjs_auth");
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

// ---- Iniciar servidor ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Servidor LF Imóveis rodando em http://localhost:${PORT}`);
  console.log("📋 Abra o navegador e use o painel normalmente.");
  console.log("📱 Clique em 'Conectar WhatsApp' para escanear o QR Code.\n");
});
