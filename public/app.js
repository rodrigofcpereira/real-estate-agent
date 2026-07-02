// =============================================
//  Tech Corretor – app.js
//  Dados de exemplo + toda a lógica da interface
// =============================================

// ---- Servidor backend ----
const CLOUD_SERVER = 'http://34.121.96.26:3000'; // Google Cloud VM

function isElectron() {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}
function getAPIBase() {
  // Electron (desktop) → servidor local embutido
  if (isElectron()) return window.location.origin;
  // Browser (web) → servidor Google Cloud
  return CLOUD_SERVER;
}
let API_BASE = getAPIBase();

// ---- Estado WhatsApp ----
let waStatus = "desconectado";
let socket = null;

// ---- Firebase listeners ----
let unsubscribeClientes = null;
let unsubscribePropriedades = null;

// ---- Estado global ----
let todosOsDados = [];
let dadosFiltrados = [];
let chipAtivo = 'todos';

// ---- Inicialização ----
document.addEventListener("DOMContentLoaded", () => {
  iniciarSocket();

  // Máscara automática de data (DD/MM/AAAA)
  ["f-nascimento","f-inicio","f-termino"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function() {
      let v = this.value.replace(/\D/g,"");
      if (v.length > 2) v = v.slice(0,2) + "/" + v.slice(2);
      if (v.length > 5) v = v.slice(0,5) + "/" + v.slice(5);
      this.value = v.slice(0,10);
    });
  });

  // Máscara de telefone brasileiro (DD) 9XXXX-XXXX ou (DD) XXXX-XXXX
  const telEl = document.getElementById("f-telefone");
  if (telEl) {
    telEl.addEventListener("input", function() {
      let v = this.value.replace(/\D/g, "");

      // Limita a 11 dígitos (DDD + 9 dígitos celular)
      v = v.slice(0, 11);

      // Aplica máscara progressiva
      if (v.length === 0) {
        this.value = "";
      } else if (v.length <= 2) {
        this.value = `(${v}`;
      } else if (v.length <= 6) {
        this.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
      } else if (v.length <= 10) {
        // Fixo: (DD) XXXX-XXXX
        this.value = `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
      } else {
        // Celular: (DD) 9XXXX-XXXX
        this.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      }
    });

    // Ao colar números no formato antigo (ex: 81-99748-4557), converter automaticamente
    telEl.addEventListener("paste", function(e) {
      setTimeout(() => {
        this.dispatchEvent(new Event("input"));
      }, 10);
    });
  }
});

// ---- Iniciar carregamento (chamado pelo auth.js após login) ----
function iniciarCarregamento() {
  carregarDados();
  carregarPropriedades();
}

// ---- Carregar dados do Firestore (tempo real) ----
function carregarDados() {
  if (unsubscribeClientes) {
    unsubscribeClientes();
    unsubscribeClientes = null;
  }
  unsubscribeClientes = db.collection("clientes")
    .orderBy("createdAt", "asc")
    .onSnapshot(snapshot => {
      todosOsDados = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        data._firestoreId = doc.id;
        todosOsDados.push(data);
      });
      dadosFiltrados = [...todosOsDados];
      atualizarKPIs();
      renderizarTabela(dadosFiltrados);
    }, error => {
      console.error("Erro ao carregar clientes:", error);
      mostrarToast("❌ Erro ao carregar dados do servidor.", "err");
    });
}

// ---- Utilitário: parsear data dd/mm/yyyy ----
function parsarData(str) {
  if (!str) return null;
  const p = str.split("/");
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
}

// ---- Utilitário: formatar telefone para máscara (DD) XXXXX-XXXX ----
function formatarTelefone(tel) {
  if (!tel) return "";
  let v = tel.replace(/\D/g, "").slice(0, 11);
  if (v.length === 0) return "";
  if (v.length <= 2)  return `(${v}`;
  if (v.length <= 6)  return `(${v.slice(0,2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
}

// ---- Hoje sem hora ----
function hoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---- Checar vencido ----
function isVencido(r) {
  const t = parsarData(r.terminoContrato);
  return t && t < hoje();
}

// ---- Checar aniversariante hoje ----
function isAniversariante(r) {
  const n = parsarData(r.nascimento);
  const h = hoje();
  return n && n.getDate() === h.getDate() && n.getMonth() === h.getMonth();
}

// ---- Atualizar KPIs ----
function atualizarKPIs() {
  const total    = todosOsDados.length;
  const vencidos = todosOsDados.filter(isVencido).length;
  const ativos   = total - vencidos;
  const bdays    = todosOsDados.filter(isAniversariante).length;

  document.getElementById("kpiTotal").textContent        = total;
  document.getElementById("qtdVencidos").textContent     = vencidos;
  document.getElementById("kpiAtivos").textContent       = ativos;
  document.getElementById("kpiAniversariantes").textContent = bdays;
}

// ---- Renderizar tabela ----
function renderizarTabela(dados) {
  const tbody  = document.getElementById("corpoTabela");
  const aviso  = document.getElementById("semResultados");
  const count  = document.getElementById("tableCount");
  tbody.innerHTML = "";
  count.textContent = dados.length;

  if (dados.length === 0) { aviso.style.display = "flex"; return; }
  aviso.style.display = "none";

  // Detecta se tabela tem scroll horizontal
  requestAnimationFrame(() => {
    const wrapper = document.querySelector(".table-wrapper");
    const card = document.querySelector(".table-card");
    if (wrapper && card) {
      card.classList.toggle("is-scrollable", wrapper.scrollWidth > wrapper.clientWidth);
    }
  });

  dados.forEach(r => {
    const tr = document.createElement("tr");
    const vencido     = isVencido(r);
    const aniversario = isAniversariante(r);

    if (vencido)     tr.classList.add("vencido");
    if (aniversario) tr.classList.add("aniversariante");

    let statusBadge;
    if (aniversario) {
      statusBadge = `<span class="badge badge-bday">🎂 Aniversário</span>`;
    } else if (vencido) {
      statusBadge = `<span class="badge badge-expired">Vencido</span>`;
    } else {
      statusBadge = `<span class="badge badge-active">Ativo</span>`;
    }

    // Índice real no array todosOsDados
    const idx = todosOsDados.indexOf(r);

    tr.innerHTML = `
      <td>${r.nome}</td>
      <td>${r.telefone}</td>
      <td>${r.apartamento}</td>
      <td>${r.nascimento}</td>
      <td>${r.inicioContrato}</td>
      <td>${r.terminoContrato}</td>
      <td>${r.condominio}</td>
      <td>${statusBadge}</td>
      <td class="td-actions">
        <div class="row-actions">
          <button class="btn-icon btn-icon-edit" title="Editar" onclick="editarCliente(${idx})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon-del" title="Remover" onclick="pedirRemocao(${idx})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---- Pesquisar ----
function pesquisar() {
  const termo = document.getElementById("campoPesquisa").value.toLowerCase().trim();
  const btnLimpar = document.getElementById("btnLimpar");
  btnLimpar.style.display = termo ? "block" : "none";
  aplicarFiltros(termo);
}

// ---- Aplicar filtros (chip + pesquisa) ----
function aplicarFiltros(termoBusca) {
  const termo = termoBusca !== undefined
    ? termoBusca
    : document.getElementById("campoPesquisa").value.toLowerCase().trim();

  let base = [...todosOsDados];

  if (chipAtivo === 'vencidos') {
    base = base.filter(isVencido);
  } else if (chipAtivo === 'aniversariantes') {
    base = base.filter(isAniversariante);
  }

  if (termo) {
    base = base.filter(r => Object.values(r).some(v => v.toLowerCase().includes(termo)));
  }

  dadosFiltrados = base;
  renderizarTabela(dadosFiltrados);
}

// ---- Set chip ----
function setChip(tipo) {
  chipAtivo = tipo;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
  const chip = document.getElementById("chip-" + tipo);
  if (chip) chip.classList.add("chip-active");
  aplicarFiltros();
}

// ---- Limpar pesquisa ----
function limparPesquisa() {
  document.getElementById("campoPesquisa").value = "";
  document.getElementById("btnLimpar").style.display = "none";
  aplicarFiltros("");
}

// ---- Limpar filtros ----
function limparFiltros() { setChip('todos'); limparPesquisa(); }

// ---- Atualizar dados ----
async function atualizarDados() {
  mostrarToast("✅ Dados atualizados em tempo real!");
}

// ---- Modal mensagem ----
function abrirModal(titulo, texto, links) {
  document.getElementById("modalTitulo").textContent = titulo;
  document.getElementById("modalTexto").textContent  = texto;
  const lista = document.getElementById("modalLista");
  lista.innerHTML = "";
  links.forEach(l => {
    const a = document.createElement("a");
    a.href = l.url;
    a.target = "_blank";
    a.textContent = l.label;
    lista.appendChild(a);
  });
  document.getElementById("modalMsg").style.display = "flex";
}
function fecharModal() { document.getElementById("modalMsg").style.display = "none"; }

// ---- Modal escolha de mensagem ----
function abrirModalMensagem() {
  if (waStatus !== "pronto" || !socket) {
    mostrarToast("❌ WhatsApp não conectado.", "err");
    _waContinuar = () => {
      _waContinuar = null;
      abrirModalMensagemDirect();
    };
    abrirModalWA();
    iniciarWA();
    return;
  }
  abrirModalMensagemDirect();
}

function abrirModalMensagemDirect() {
  document.getElementById("disparo-titulo").textContent = "📤 Enviar mensagem";
  document.getElementById("disparo-suggestions").style.display = "flex";

  // Começa na opção "Livre": todos os clientes, mensagem vazia
  document.querySelectorAll(".sug-btn").forEach(b => b.classList.remove("active"));
  const livreBtn = document.getElementById("sug-livre");
  if (livreBtn) livreBtn.classList.add("active");

  document.getElementById("disparo-mensagem").value = "";
  mensagemTipoAtivo = null;
  propIndexDisparo = -1;

  const lista = document.getElementById("disparo-lista");
  lista.innerHTML = todosOsDados.map((c, i) => `
    <label class="disparo-item">
      <input type="checkbox" class="disparo-check" value="${i}" onchange="atualizarContadorDisparo()" checked />
      <div class="disparo-item-info">
        <div class="disparo-item-nome">${c.nome}</div>
        <div class="disparo-item-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}</div>
      </div>
    </label>`).join('');

  atualizarContadorDisparo();
  document.getElementById("modalDisparo").style.display = "flex";
}

// ---- Fechar modais clicando fora ----
document.addEventListener("click", e => {
  ["modalMsg", "modalCliente", "modalConfirm", "modalDisparo", "modalWA", "modalProp"].forEach(id => {
    const el = document.getElementById(id);
    if (e.target === el) el.style.display = "none";
  });
});

// ---- Toast ----
let toastTimer;
function mostrarToast(msg, tipo = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (tipo === "ok" ? " toast-ok" : tipo === "err" ? " toast-err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

// ==============================================
//  CRUD – Adicionar / Editar / Remover clientes
// ==============================================

let clienteParaRemover = -1;

// ---- Abrir form (novo) ----
function abrirFormCliente() {
  document.getElementById("formTitulo").textContent  = "Novo cliente";
  document.getElementById("btnSalvar").textContent   = "Salvar cliente";
  document.getElementById("clienteIndex").value      = -1;
  document.getElementById("formCliente").reset();
  limparErrosForm();
  document.getElementById("modalCliente").style.display = "flex";
  setTimeout(() => document.getElementById("f-nome").focus(), 100);
}

// ---- Abrir form (editar) ----
function editarCliente(idx) {
  const r = todosOsDados[idx];
  if (!r) return;

  document.getElementById("formTitulo").textContent = "Editar cliente";
  document.getElementById("btnSalvar").textContent  = "Salvar alterações";
  document.getElementById("clienteIndex").value     = idx;

  document.getElementById("f-nome").value         = r.nome;
  document.getElementById("f-telefone").value     = formatarTelefone(r.telefone);
  document.getElementById("f-apartamento").value  = r.apartamento;
  document.getElementById("f-condominio").value   = r.condominio;
  document.getElementById("f-nascimento").value   = r.nascimento;
  document.getElementById("f-inicio").value       = r.inicioContrato;
  document.getElementById("f-termino").value      = r.terminoContrato;

  limparErrosForm();
  document.getElementById("modalCliente").style.display = "flex";
  setTimeout(() => document.getElementById("f-nome").focus(), 100);
}

// ---- Salvar (criar ou atualizar) ----
async function salvarCliente(e) {
  e.preventDefault();
  if (!validarForm()) return;

  const idx = parseInt(document.getElementById("clienteIndex").value);
  const cliente = {
    nome:           document.getElementById("f-nome").value.trim(),
    telefone:       document.getElementById("f-telefone").value.trim(),
    apartamento:    document.getElementById("f-apartamento").value.trim(),
    condominio:     document.getElementById("f-condominio").value.trim(),
    nascimento:     document.getElementById("f-nascimento").value.trim(),
    inicioContrato: document.getElementById("f-inicio").value.trim(),
    terminoContrato:document.getElementById("f-termino").value.trim(),
  };

  try {
    if (idx === -1) {
      cliente.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("clientes").add(cliente);
      mostrarToast("✅ Cliente adicionado!", "ok");
    } else {
      const docId = todosOsDados[idx]._firestoreId || todosOsDados[idx].id;
      cliente.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("clientes").doc(docId).update(cliente);
      mostrarToast("✅ Cliente atualizado!", "ok");
    }
  } catch (err) {
    console.error("Erro ao salvar cliente:", err);
    mostrarToast("❌ Erro ao salvar no servidor.", "err");
  }

  fecharFormCliente();
}

// ---- Validar form ----
function validarForm() {
  let ok = true;
  const campos = ["f-nome","f-telefone","f-apartamento","f-condominio","f-nascimento","f-inicio","f-termino"];
  campos.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add("input-error");
      ok = false;
    } else {
      el.classList.remove("input-error");
    }
  });

  // Validar formato de data nos campos de data
  ["f-nascimento","f-inicio","f-termino"].forEach(id => {
    const el  = document.getElementById(id);
    const val = el.value.trim();
    if (val && !/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      el.classList.add("input-error");
      ok = false;
    }
  });

  if (!ok) mostrarToast("⚠️ Preencha todos os campos corretamente.", "err");
  return ok;
}

function limparErrosForm() {
  document.querySelectorAll(".client-form .input-error").forEach(el => el.classList.remove("input-error"));
}

// ---- Fechar form ----
function fecharFormCliente() {
  document.getElementById("modalCliente").style.display = "none";
}

// ---- Pedir confirmação de remoção ----
function pedirRemocao(idx) {
  const r = todosOsDados[idx];
  if (!r) return;
  clienteParaRemover = idx;
  const tituloEl = document.getElementById("confirm-titulo");
  if (tituloEl) tituloEl.textContent = "Remover cliente";
  document.getElementById("confirmNome").textContent = r.nome;
  document.getElementById("btnConfirmRemover").onclick = confirmarRemocao;
  document.getElementById("modalConfirm").style.display = "flex";
}

// ---- Confirmar remoção ----
async function confirmarRemocao() {
  if (clienteParaRemover < 0) return;
  const r = todosOsDados[clienteParaRemover];
  const nome = r.nome;
  const docId = r._firestoreId || r.id;
  clienteParaRemover = -1;
  try {
    await db.collection("clientes").doc(docId).delete();
    mostrarToast(`🗑️ ${nome} removido.`);
  } catch (err) {
    console.error("Erro ao remover cliente:", err);
    mostrarToast("❌ Erro ao remover do servidor.", "err");
  }
  fecharConfirm();
}

function fecharConfirm() {
  document.getElementById("modalConfirm").style.display = "none";
  clienteParaRemover = -1;
}

// ==============================================
//  SIDEBAR TOGGLE (mobile)
// ==============================================
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  let overlay = document.getElementById("sidebar-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    overlay.id = "sidebar-overlay";
    overlay.onclick = toggleSidebar;
    document.body.appendChild(overlay);
  }
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show", sidebar.classList.contains("open"));
}

// Fecha sidebar ao navegar no mobile
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-item, .nav-item-wa").forEach(el => {
    el.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        const sidebar = document.querySelector(".sidebar");
        const overlay = document.getElementById("sidebar-overlay");
        sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("show");
      }
    });
  });
});

// ==============================================
//  WHATSAPP – Socket.io
// ==============================================

function iniciarSocket() {
  try {
    socket = io(API_BASE, { transports: ["websocket"], reconnectionAttempts: 3, timeout: 3000 });

    socket.on("connect", () => {
      console.log("🔌 Conectado ao servidor");
    });

    socket.on("connect_error", () => {
      socket = null;
    });

    socket.on("wa:status", (data) => {
      atualizarStatusWA(data.status, data.message);

      // Auto-conectar: tenta conectar automaticamente ao carregar
      if (!window._waAutoConnectDone) {
        window._waAutoConnectDone = true;
        if (data.status !== "pronto") {
          socket.emit("wa:iniciar");
        }
      }

      // Abre o modal automaticamente se gerou QR ou deu erro
      if (window._waAutoConnectDone && !window._waModalOpened) {
        if (data.status === "qr" || data.status === "erro") {
          window._waModalOpened = true;
          document.getElementById("modalWA").style.display = "flex";
        }
      }
    });

    socket.on("wa:qr", (data) => {
      mostrarQR(data.qr);
    });

  } catch(e) {
    socket = null;
  }
}

// ---- Timeout visual: mostra botão "Limpar Sessão" se ficar preso em conectando ----
let _conectandoTimer = null;

function atualizarStatusWA(status, msg = "") {
  waStatus = status;

  // Cancela o timer de timeout visual a cada mudança de status
  if (_conectandoTimer) { clearTimeout(_conectandoTimer); _conectandoTimer = null; }
  const timeoutEl = document.getElementById("wa-connecting-timeout");
  if (timeoutEl) timeoutEl.style.display = "none";

  // Sidebar WhatsApp item
  const sidebarWa    = document.getElementById("sidebar-wa");
  const sidebarDot   = document.getElementById("sidebar-wa-dot");
  const sidebarText  = document.getElementById("sidebar-wa-text");
  const sidebarBtn   = document.getElementById("sidebar-wa-btn");

  const modalDot  = document.getElementById("waStatusDot");
  const modalText = document.getElementById("waStatusText");

  const estados = {
    desconectado: { dot: "red",   txt: "Desconectado",   btn: "Conectar",   sidebarClass: "" },
    qr:           { dot: "yellow",txt: "Aguardando QR",  btn: "QR Code",    sidebarClass: "" },
    conectando:   { dot: "yellow",txt: "Conectando...",   btn: "Abrindo...", sidebarClass: "" },
    autenticado:  { dot: "yellow",txt: "Autenticando...", btn: "Abrindo...", sidebarClass: "" },
    pronto:       { dot: "green", txt: "Conectado",       btn: "Gerenciar", sidebarClass: "connected" },
    erro:         { dot: "red",   txt: "Erro",            btn: "Reconectar", sidebarClass: "" },
  };
  const e = estados[status] || estados.desconectado;

  // Sidebar
  if (sidebarDot)  sidebarDot.className = "nav-item-wa-dot " + e.dot;
  if (sidebarText) sidebarText.textContent = e.txt + (msg && status === "erro" ? " – " + msg : "");
  if (sidebarBtn)  sidebarBtn.textContent = e.btn;
  if (sidebarWa)   sidebarWa.className = "nav-item-wa" + (e.sidebarClass ? " " + e.sidebarClass : "");

  // Modal status bar
  if (modalDot)  modalDot.className = "wa-dot-sm " + e.dot;
  if (modalText) modalText.textContent = e.txt + (msg ? " – " + msg : "");

  // Mostrar painel correto dentro do modal
  const paineis = ["desconectado","qr","conectando","pronto","erro"];
  paineis.forEach(p => {
    const el = document.getElementById("wa-state-" + p);
    if (el) el.style.display = "none";
  });

  const mapa = { desconectado:"desconectado", qr:"qr", conectando:"conectando",
                  autenticado:"conectando", pronto:"pronto", erro:"erro" };
  const painel = document.getElementById("wa-state-" + (mapa[status] || "desconectado"));
  if (painel) painel.style.display = "flex";

  if (status === "conectando" || status === "autenticado") {
    const el = document.getElementById("wa-connecting-msg");
    if (el) el.textContent = msg || "Autenticando sessão, aguarde.";

    // Após 30s preso em "autenticando", mostra botão de limpeza de sessão
    _conectandoTimer = setTimeout(() => {
      const te = document.getElementById("wa-connecting-timeout");
      if (te && (waStatus === "conectando" || waStatus === "autenticado")) te.style.display = "block";
    }, 30000);
  }
  if (status === "erro") {
    const el = document.getElementById("wa-error-msg");
    if (el) el.textContent = msg || "Tente reconectar.";
  }
  if (status === "pronto") {
    mostrarToast("✅ WhatsApp conectado com sucesso!", "ok");
  }
}

function mostrarQR(qrDataURL) {
  const img     = document.getElementById("wa-qr-img");
  const spinner = document.getElementById("wa-qr-spinner");
  if (img) {
    img.src = qrDataURL;
    img.style.display = "block";
  }
  if (spinner) spinner.style.display = "none";
}

// ---- Abrir/fechar modal WA ----
function abrirModalWA() {
  if (!socket) {
    mostrarToast("⚠️ Servidor offline. Inicie com: npm start", "err");
    return;
  }
  // Fecha sidebar no mobile ao abrir modal
  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("show");
  }
  document.getElementById("modalWA").style.display = "flex";
}
function fecharModalWA() {
  document.getElementById("modalWA").style.display = "none";
}

let _waContinuar = null;

function continuarSemWA() {
  fecharModalWA();
  if (typeof _waContinuar === "function") {
    const fn = _waContinuar;
    _waContinuar = null;
    fn();
  }
}

// ---- Iniciar WA (emit) ----
function iniciarWA() {
  if (!socket) { mostrarToast("⚠️ Servidor não encontrado.", "err"); return; }

  // Resetar QR
  const img     = document.getElementById("wa-qr-img");
  const spinner = document.getElementById("wa-qr-spinner");
  if (img)     { img.src = ""; img.style.display = "none"; }
  if (spinner)   spinner.style.display = "flex";

  atualizarStatusWA("qr");
  socket.emit("wa:iniciar");
}

// ---- Desconectar WA ----
function desconectarWA() {
  if (!socket) return;
  socket.emit("wa:desconectar");
}

// ---- Limpar sessão corrompida ----
async function limparSessaoWA() {
  if (!socket) { mostrarToast("⚠️ Servidor não encontrado.", "err"); return; }
  try {
    const resp = await fetch(`${API_BASE}/api/limpar-sessao`, { method: "POST" });
    const data = await resp.json();
    if (data.ok) {
      mostrarToast("🗑️ Sessão limpa! Clique em 'Gerar QR Code' para reconectar.", "ok");
    } else {
      mostrarToast("❌ Erro ao limpar sessão.", "err");
    }
  } catch(e) {
    mostrarToast("❌ Não foi possível limpar a sessão.", "err");
  }
}

// ==============================================
//  ENVIO DE MENSAGENS – via backend ou WhatsApp Web
// ==============================================

// ---- Aplicar sugestão de mensagem (menu horizontal) ----
function aplicarSugestao(tipo) {
  const h = hoje();
  let clientes = [], msgFn = () => "";
  const titulos = {
    aniversario: "🎂 Mensagem de Aniversário",
    contrato_vencido: "📋 Aviso de Contrato Vencido",
    ano_novo: "🎆 Mensagem de Ano Novo"
  };

  if (tipo === "livre") {
    document.querySelectorAll(".sug-btn").forEach(b => b.classList.remove("active"));
    const btn = document.getElementById("sug-livre");
    if (btn) btn.classList.add("active");

    document.getElementById("disparo-mensagem").value = "";
    mensagemTipoAtivo = null;

    const lista = document.getElementById("disparo-lista");
    lista.innerHTML = todosOsDados.map((c, i) => `
      <label class="disparo-item">
        <input type="checkbox" class="disparo-check" value="${i}" onchange="atualizarContadorDisparo()" checked />
        <div class="disparo-item-info">
          <div class="disparo-item-nome">${c.nome}</div>
          <div class="disparo-item-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}</div>
        </div>
      </label>`).join('');
    atualizarContadorDisparo();
    return;
  }

  if (tipo === "aniversario") {
    clientes = todosOsDados.filter(isAniversariante);
    msgFn = r => `Feliz aniversário, {nome}! 🎉 A equipe Tech Corretor deseja um dia incrível para você!`;
  } else if (tipo === "contrato_vencido") {
    clientes = todosOsDados.filter(isVencido);
    msgFn = r => `Olá, {nome}! Seu contrato do apartamento {apartamento} venceu em {terminoContrato}. Entre em contato para renovação.`;
  } else if (tipo === "ano_novo") {
    clientes = todosOsDados;
    msgFn = r => `Feliz Ano Novo, {nome}! 🎆 Nós agradecemos sua confiança e desejamos realizações incríveis!`;
  }

  // Destaca o botão ativo
  document.querySelectorAll(".sug-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("sug-" + tipo);
  if (btn) btn.classList.add("active");

  // Preenche a mensagem
  const msgExemplo = clientes.length > 0 ? msgFn(clientes[0]) : "";
  document.getElementById("disparo-mensagem").value = msgExemplo;

  // Filtra a lista de clientes
  const lista = document.getElementById("disparo-lista");
  if (clientes.length === 0) {
    lista.innerHTML = `<div class="sem-resultados" style="display:flex;padding:24px"><p>Nenhum cliente encontrado para esta sugestão.</p></div>`;
    atualizarContadorDisparo();
    return;
  }

  lista.innerHTML = clientes.map(c => {
    const idx = todosOsDados.indexOf(c);
    return `
    <label class="disparo-item">
      <input type="checkbox" class="disparo-check" value="${idx}" onchange="atualizarContadorDisparo()" checked />
      <div class="disparo-item-info">
        <div class="disparo-item-nome">${c.nome}</div>
        <div class="disparo-item-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}</div>
      </div>
    </label>`;
  }).join('');

  mensagemTipoAtivo = { tipo, titulo: titulos[tipo], msgFn };
  atualizarContadorDisparo();
}

async function enviarViaBackend(titulo, clientes, msgFn, fotos = []) {
  // Monta lista visual no modal
  document.getElementById("modalTitulo").textContent = titulo;
  document.getElementById("modalTexto").textContent  = `Enviando para ${clientes.length} cliente(s)...`;
  const lista = document.getElementById("modalLista");
  lista.innerHTML = "";
  lista.className = "send-progress";

  // Criar itens visuais com status "aguardando"
  clientes.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "send-item";
    div.id = "send-item-" + i;
    div.innerHTML = `
      <span class="send-item-name">${r.nome} <small style="opacity:.6">· Apto ${r.apartamento}</small></span>
      <span class="send-item-status send-pending" id="send-status-${i}">⏳ Aguardando</span>
    `;
    lista.appendChild(div);
  });

  document.getElementById("modalMsg").style.display = "flex";

  // Enviar em lote via API
  // As fotos vão uma vez só no body — não duplicadas por destinatário
  const fotosArray = Array.isArray(fotos) ? fotos : (fotos ? [fotos] : []);
  const payload = clientes.map(r => ({ telefone: r.telefone, mensagem: msgFn(r) }));

  let data;
  try {
    const res = await fetch(`${API_BASE}/api/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagens: payload, fotos: fotosArray })
    });

    if (!res.ok) {
      // Erro HTTP (ex: 503 WhatsApp desconectado, 500 interno)
      let errMsg = `Erro ${res.status}`;
      try { const e = await res.json(); errMsg = e.erro || errMsg; } catch(_) {}
      throw new Error(errMsg);
    }

    data = await res.json();
  } catch (err) {
    // Falha de rede ou erro HTTP
    const isOffline = err.message.includes("fetch") || err.message.includes("Failed");
    const msgErr = isOffline
      ? "Não foi possível conectar ao servidor. Verifique se ele está rodando (npm start)."
      : err.message;

    // Marcar todos como erro
    clientes.forEach((_, i) => {
      const el = document.getElementById("send-status-" + i);
      if (el) { el.textContent = "❌ Não enviado"; el.className = "send-item-status send-err"; }
    });

    document.getElementById("modalTexto").innerHTML =
      `<span class="send-error-banner">❌ Falha no envio — ${msgErr}</span>`;
    return;
  }

  // Processar resultado de cada item
  if (data && data.resultados) {
    let qtdOk = 0, qtdErr = 0;

    data.resultados.forEach((r, i) => {
      const el = document.getElementById("send-status-" + i);
      if (!el) return;
      if (r.ok) {
        el.textContent = "✅ Enviado";
        el.className   = "send-item-status send-ok";
        qtdOk++;
      } else {
        // Mostra o motivo do erro de cada item individualmente
        const motivo = r.erro || "número inválido ou bloqueado";
        el.textContent = `❌ Erro`;
        el.className   = "send-item-status send-err";
        el.title       = motivo; // tooltip com detalhe

        // Adiciona linha de detalhe do erro abaixo do item
        const item = document.getElementById("send-item-" + i);
        if (item) {
          const det = document.createElement("div");
          det.className = "send-item-error-detail";
          det.textContent = `↳ ${motivo}`;
          item.after(det);
        }
        qtdErr++;
      }
    });

    // Resumo final
    const textoFinal = qtdErr === 0
      ? `✅ Todas as ${qtdOk} mensagens enviadas com sucesso!`
      : qtdOk === 0
        ? `❌ Nenhuma mensagem foi enviada. Verifique os números.`
        : `⚠️ ${qtdOk} enviada(s) com sucesso · ${qtdErr} com erro`;

    document.getElementById("modalTexto").innerHTML =
      `<span class="${qtdErr === 0 ? 'send-summary-ok' : qtdOk === 0 ? 'send-summary-err' : 'send-summary-warn'}">${textoFinal}</span>`;
  }
}

// ==============================================
//  NAVEGAÇÃO ENTRE PÁGINAS
// ==============================================
function irPara(pagina) {
  ['dashboard', 'propriedades', 'configuracoes'].forEach(p => {
    const el  = document.getElementById('page-' + p);
    const nav = document.getElementById('nav-' + p);
    if (el)  el.style.display = (p === pagina) ? 'flex' : 'none';
    if (nav) nav.classList.toggle('active', p === pagina);
  });
  if (pagina === 'propriedades') renderizarPropriedades();
  if (pagina === 'configuracoes') carregarTelaConfiguracoes();
}

// ==============================================
//  PROPRIEDADES
// ==============================================

let propriedades       = [];
let propIndexRemover   = -1;
let propIndexDisparo   = -1;
let mensagemTipoAtivo  = null;

// ---- Carregar propriedades do Firestore (tempo real) ----
function carregarPropriedades() {
  if (unsubscribePropriedades) {
    unsubscribePropriedades();
    unsubscribePropriedades = null;
  }
  unsubscribePropriedades = db.collection("propriedades")
    .orderBy("createdAt", "desc")
    .onSnapshot(snapshot => {
      propriedades = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        data._firestoreId = doc.id;
        propriedades.push(data);
      });
      renderizarPropriedades();
    }, error => {
      console.error("Erro ao carregar propriedades:", error);
    });
}

// ---- Renderizar grid ----
function renderizarPropriedades() {
  const grid  = document.getElementById("props-grid");
  const empty = document.getElementById("props-empty");
  if (!grid) return;

  if (propriedades.length === 0) {
    if (empty) empty.style.display = "flex";
    grid.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  if (empty) empty.style.display = "none";
  grid.style.display = "grid";

  const tipoClasses = {
    "Casa":      "prop-tipo-casa",
    "Cobertura": "prop-tipo-cobertura",
    "Comercial": "prop-tipo-comercial",
    "Terreno":   "prop-tipo-terreno",
  };

  grid.innerHTML = propriedades.map((p, i) => {
    const tipoClass = tipoClasses[p.tipo] || "";
    const fotos = Array.isArray(p.fotos) && p.fotos.length ? p.fotos
                  : (p.foto ? [p.foto] : []);  // compatibilidade com registros antigos

    // ---- área de imagem: carrossel ou placeholder ----
    let imgAreaHtml;
    if (fotos.length === 0) {
      imgAreaHtml = `
        <div class="prop-img">
          <svg class="prop-img-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" width="52" height="52"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>`;
    } else if (fotos.length === 1) {
      imgAreaHtml = `
        <div class="prop-img">
          <img src="${fotos[0]}" alt="Foto" />
        </div>`;
    } else {
      const slides = fotos.map(f =>
        `<div class="prop-carousel-slide"><img src="${f}" alt="Foto" /></div>`
      ).join('');
      const dots = fotos.map((_, di) =>
        `<button class="prop-carousel-dot${di === 0 ? ' active' : ''}" onclick="carouselDot(this,${i},${di})"></button>`
      ).join('');
      imgAreaHtml = `
        <div class="prop-carousel" id="carousel-${i}">
          <div class="prop-carousel-track" id="carousel-track-${i}">${slides}</div>
          <button class="prop-carousel-btn prev" onclick="carouselPrev(${i})">‹</button>
          <button class="prop-carousel-btn next" onclick="carouselNext(${i})">›</button>
          <div class="prop-carousel-dots">${dots}</div>
          <span class="prop-carousel-counter">1 / ${fotos.length}</span>
        </div>`;
    }

    const detalhes = [];
    if (p.quartos)   detalhes.push(`<span class="prop-detail-item">🛏️ ${p.quartos}</span>`);
    if (p.banheiros) detalhes.push(`<span class="prop-detail-item">🚿 ${p.banheiros}</span>`);
    if (p.vagas)     detalhes.push(`<span class="prop-detail-item">🚗 ${p.vagas}</span>`);
    if (p.area)      detalhes.push(`<span class="prop-detail-item">📐 ${p.area}</span>`);

    const endereco = [p.endereco, p.bairro, p.cidade].filter(Boolean).join(', ');

    return `
      <div class="prop-card">
        ${imgAreaHtml}
        <div class="prop-body">
          <span class="prop-tipo ${tipoClass}">${p.tipo}</span>
          <h3 class="prop-titulo">${p.titulo}</h3>
          ${endereco ? `<p class="prop-endereco">📍 ${endereco}</p>` : ''}
          ${detalhes.length ? `<div class="prop-details">${detalhes.join('')}</div>` : ''}
          ${p.descricao ? `<p class="prop-desc">${p.descricao}</p>` : ''}
          <div class="prop-footer">
            <span class="prop-preco">${p.preco || '—'}</span>
            <div class="prop-actions">
              <button class="btn-icon btn-icon-edit" onclick="abrirFormProp(${i})" title="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-icon-del" onclick="confirmarRemoverProp(${i})" title="Remover">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
              <button class="btn btn-primary btn-sm-icon" onclick="abrirModalDisparo(${i})" style="font-size:.77rem;padding:6px 11px;gap:5px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Disparar
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---- Formulário de cadastro ----
function abrirFormProp(idx = -1) {
  const editando = idx >= 0 && propriedades[idx];
  document.getElementById("prop-id").value = idx;
  document.getElementById("prop-form-titulo").textContent = editando ? "Editar propriedade" : "Nova propriedade";

  // Limpa campos
  ["p-titulo","p-tipo","p-endereco","p-bairro","p-cidade",
   "p-preco","p-area","p-quartos","p-banheiros","p-vagas","p-desc"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("p-tipo").value = "Apartamento";

  // Reset fotos
  fotosTemp = [];
  renderizarFotosForm();
  document.getElementById("p-fotos").value = "";

  if (editando) {
    const p = propriedades[idx];
    document.getElementById("p-titulo").value    = p.titulo    || "";
    document.getElementById("p-tipo").value      = p.tipo      || "Apartamento";
    document.getElementById("p-endereco").value  = p.endereco  || "";
    document.getElementById("p-bairro").value    = p.bairro    || "";
    document.getElementById("p-cidade").value    = p.cidade    || "";
    document.getElementById("p-preco").value     = p.preco     || "";
    document.getElementById("p-area").value      = p.area      || "";
    document.getElementById("p-quartos").value   = p.quartos   || "";
    document.getElementById("p-banheiros").value = p.banheiros || "";
    document.getElementById("p-vagas").value     = p.vagas     || "";
    document.getElementById("p-desc").value      = p.descricao || "";
    // Carrega fotos existentes (suporta campo antigo `foto` e novo `fotos`)
    if (Array.isArray(p.fotos) && p.fotos.length) {
      fotosTemp = [...p.fotos];
    } else if (p.foto) {
      fotosTemp = [p.foto];
    }
    renderizarFotosForm();
  }

  document.getElementById("modalProp").style.display = "flex";
}

function fecharFormProp() {
  document.getElementById("modalProp").style.display = "none";
}

async function salvarProp(event) {
  event.preventDefault();
  const idx = parseInt(document.getElementById("prop-id").value);

  const prop = {
    titulo:    document.getElementById("p-titulo").value.trim(),
    tipo:      document.getElementById("p-tipo").value,
    endereco:  document.getElementById("p-endereco").value.trim(),
    bairro:    document.getElementById("p-bairro").value.trim(),
    cidade:    document.getElementById("p-cidade").value.trim(),
    preco:     document.getElementById("p-preco").value.trim(),
    area:      document.getElementById("p-area").value.trim(),
    quartos:   document.getElementById("p-quartos").value,
    banheiros: document.getElementById("p-banheiros").value,
    vagas:     document.getElementById("p-vagas").value,
    descricao: document.getElementById("p-desc").value.trim(),
  };

  const btn = event.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }

  try {
    // Upload das fotos (base64 → Storage)
    const fotosUrls = await uploadFotos(fotosTemp);
    prop.fotos = fotosUrls;

    if (idx === -1) {
      prop.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("propriedades").add(prop);
      mostrarToast("✅ Propriedade cadastrada!", "ok");
    } else {
      const docId = propriedades[idx]._firestoreId || propriedades[idx].id;
      await db.collection("propriedades").doc(docId).update(prop);
      mostrarToast("✅ Propriedade atualizada!", "ok");
    }
  } catch (err) {
    console.error("Erro ao salvar propriedade:", err);
    mostrarToast("❌ Erro ao salvar no servidor.", "err");
  }

  fotosTemp = [];
  if (btn) { btn.disabled = false; btn.textContent = "Salvar propriedade"; }
  fecharFormProp();
}

// ---- Upload de fotos para Firebase Storage ----
async function uploadFotos(fotosArray) {
  const urls = [];
  for (const foto of fotosArray) {
    if (foto.startsWith("https://")) {
      urls.push(foto);
      continue;
    }
    try {
      const fileName = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const ref = storage.ref(`fotos/${currentUser.uid}/${fileName}`);
      const snapshot = await ref.putString(foto, "data_url");
      const url = await snapshot.ref.getDownloadURL();
      urls.push(url);
    } catch (err) {
      console.error("Erro ao fazer upload de foto:", err);
    }
  }
  return urls;
}

// ---- Gerenciamento de múltiplas fotos no formulário ----
let fotosTemp = []; // base64[] das fotos do formulário aberto

function handleFotos(event) {
  const files = [...event.target.files];
  const limite = 10;
  const restam = limite - fotosTemp.length;
  if (restam <= 0) { mostrarToast("⚠️ Limite de 10 fotos atingido.", "err"); return; }

  const filesToProcess = files.slice(0, restam);
  if (files.length > restam) mostrarToast(`⚠️ Apenas ${restam} foto(s) adicionada(s) (limite de ${limite}).`, "err");

  let processed = 0;
  filesToProcess.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      fotosTemp.push(e.target.result);
      processed++;
      if (processed === filesToProcess.length) renderizarFotosForm();
    };
    reader.readAsDataURL(file);
  });
  // Limpa o input para permitir re-selecionar os mesmos arquivos
  event.target.value = "";
}

function renderizarFotosForm() {
  const grid = document.getElementById("fotos-grid");
  if (!grid) return;

  const thumbs = fotosTemp.map((src, i) => `
    <div class="foto-thumb">
      <img src="${src}" alt="Foto ${i+1}" />
      ${i === 0 ? '<span class="foto-thumb-badge">Principal</span>' : ''}
      <button type="button" class="foto-thumb-remove" onclick="removerFotoForm(${i})" title="Remover">✕</button>
    </div>`).join('');

  const addBtn = fotosTemp.length < 10 ? `
    <div class="foto-add-btn" onclick="document.getElementById('p-fotos').click()" title="Adicionar foto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span>Adicionar foto</span>
    </div>` : '';

  grid.innerHTML = thumbs + addBtn;
}

function removerFotoForm(idx) {
  fotosTemp.splice(idx, 1);
  renderizarFotosForm();
}

// ---- Carrossel do card ----
const _carouselIdx = {}; // { propIdx: slideAtual }

function carouselIr(propIdx, slide) {
  const p = propriedades[propIdx];
  const fotos = Array.isArray(p.fotos) && p.fotos.length ? p.fotos : (p.foto ? [p.foto] : []);
  const total  = fotos.length;
  if (total <= 1) return;

  slide = ((slide % total) + total) % total; // wrap
  _carouselIdx[propIdx] = slide;

  const track   = document.getElementById(`carousel-track-${propIdx}`);
  const counter = document.querySelector(`#carousel-${propIdx} .prop-carousel-counter`);
  const dots    = document.querySelectorAll(`#carousel-${propIdx} .prop-carousel-dot`);

  if (track)   track.style.transform = `translateX(-${slide * 100}%)`;
  if (counter) counter.textContent   = `${slide + 1} / ${total}`;
  dots.forEach((d, di) => d.classList.toggle('active', di === slide));
}

function carouselNext(propIdx) {
  carouselIr(propIdx, (_carouselIdx[propIdx] || 0) + 1);
}
function carouselPrev(propIdx) {
  carouselIr(propIdx, (_carouselIdx[propIdx] || 0) - 1);
}
function carouselDot(btn, propIdx, slide) {
  carouselIr(propIdx, slide);
}

// ---- Remover propriedade ----
function confirmarRemoverProp(idx) {
  propIndexRemover = idx;
  const p = propriedades[idx];
  const tituloEl = document.getElementById("confirm-titulo");
  if (tituloEl) tituloEl.textContent = "Remover propriedade";
  document.getElementById("confirmNome").textContent = p.titulo;
  document.getElementById("btnConfirmRemover").onclick = async () => {
    const docId = propriedades[propIndexRemover]._firestoreId || propriedades[propIndexRemover].id;
    try {
      await db.collection("propriedades").doc(docId).delete();
      mostrarToast("🗑️ Propriedade removida.", "ok");
    } catch (err) {
      console.error("Erro ao remover propriedade:", err);
      mostrarToast("❌ Erro ao remover do servidor.", "err");
    }
    propIndexRemover = -1;
    fecharConfirm();
  };
  document.getElementById("modalConfirm").style.display = "flex";
}

// ---- Gerar mensagem da propriedade ----
function gerarMensagemProp(prop) {
  const linhas = [];
  linhas.push(`🏠 *${prop.titulo}*`);
  linhas.push('');

  const info = [prop.tipo, prop.area].filter(Boolean).join(' · ');
  if (info) linhas.push(`🏷️ ${info}`);

  const end = [prop.endereco, prop.bairro, prop.cidade].filter(Boolean).join(', ');
  if (end) linhas.push(`📍 ${end}`);

  const det = [];
  if (prop.quartos)   det.push(`🛏️ ${prop.quartos} quarto${prop.quartos > 1 ? 's' : ''}`);
  if (prop.banheiros) det.push(`🚿 ${prop.banheiros} banheiro${prop.banheiros > 1 ? 's' : ''}`);
  if (prop.vagas)     det.push(`🚗 ${prop.vagas} vaga${prop.vagas > 1 ? 's' : ''}`);
  if (det.length) linhas.push(det.join('  '));

  if (prop.descricao) { linhas.push(''); linhas.push(prop.descricao); }

  linhas.push('');
  if (prop.preco) linhas.push(`💰 *${prop.preco}*`);
  linhas.push('');
  linhas.push('📞 Entre em contato com *Tech Corretor* para mais informações!');

  return linhas.join('\n');
}

// ---- Modal disparo ----
function abrirModalDisparo(idx) {
  if (waStatus !== "pronto" || !socket) {
    mostrarToast("❌ WhatsApp não conectado.", "err");
    _waContinuar = () => {
      _waContinuar = null;
      abrirModalDisparoDirect(idx);
    };
    abrirModalWA();
    iniciarWA();
    return;
  }
  abrirModalDisparoDirect(idx);
}

function abrirModalDisparoDirect(idx) {
  propIndexDisparo = idx;
  mensagemTipoAtivo = null;
  const prop = propriedades[idx];

  document.getElementById("disparo-titulo").textContent = `📤 Disparar: ${prop.titulo}`;
  document.getElementById("disparo-suggestions").style.display = "none";
  document.getElementById("disparo-mensagem").value = gerarMensagemProp(prop);
  document.querySelectorAll(".sug-btn").forEach(b => b.classList.remove("active"));

  const lista = document.getElementById("disparo-lista");
  lista.innerHTML = todosOsDados.map((c, i) => `
    <label class="disparo-item">
      <input type="checkbox" class="disparo-check" value="${i}" onchange="atualizarContadorDisparo()" checked />
      <div class="disparo-item-info">
        <div class="disparo-item-nome">${c.nome}</div>
        <div class="disparo-item-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}</div>
      </div>
    </label>`).join('');

  atualizarContadorDisparo();
  document.getElementById("modalDisparo").style.display = "flex";
}

function fecharModalDisparo() {
  document.getElementById("modalDisparo").style.display = "none";
  propIndexDisparo = -1;
  mensagemTipoAtivo = null;
}

function selecionarTodosClientes(sel) {
  document.querySelectorAll(".disparo-check").forEach(cb => cb.checked = sel);
  atualizarContadorDisparo();
}

function atualizarContadorDisparo() {
  const total = document.querySelectorAll(".disparo-check:checked").length;
  const el = document.getElementById("disparo-counter");
  if (el) el.innerHTML = `<strong>${total}</strong> cliente${total !== 1 ? 's' : ''} selecionado${total !== 1 ? 's' : ''}`;
}

async function dispararPropriedade() {
  const selecionados = [...document.querySelectorAll(".disparo-check:checked")]
    .map(cb => todosOsDados[parseInt(cb.value)])
    .filter(Boolean);
  const mensagem = document.getElementById("disparo-mensagem").value;

  const propIdx = propIndexDisparo;
  const msgTipo = mensagemTipoAtivo;
  fecharModalDisparo();

  let titulo, fotos = [];

  if (propIdx >= 0) {
    const prop = propriedades[propIdx];
    titulo = `📤 Disparo: ${prop.titulo}`;
    fotos = Array.isArray(prop.fotos) && prop.fotos.length ? prop.fotos
            : (prop.foto ? [prop.foto] : []);
  } else if (msgTipo) {
    titulo = msgTipo.titulo;
  } else {
    titulo = "📤 Mensagem personalizada";
  }

  const personalizar = (txt, c) => txt.replace(/{(\w+)}/g, (_, campo) => {
    if (campo === 'nome') return c.nome.split(" ")[0];
    return c[campo] !== undefined ? c[campo] : `{${campo}}`;
  });

  const fnMensagem = (msgTipo && msgTipo.msgFn)
    ? (r) => personalizar(msgTipo.msgFn(r), r)
    : (r) => personalizar(mensagem, r);

  if (waStatus === "pronto" && socket) {
    await enviarViaBackend(titulo, selecionados, fnMensagem, fotos);
  } else {
    const links = selecionados.map(c => {
      const tel = c.telefone.replace(/\D/g, "");
      const msg = fnMensagem(c);
      return {
        label: `📲 ${c.nome} — Apto ${c.apartamento}`,
        url:   `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`
      };
    });
    abrirModal(titulo,
      `${selecionados.length} cliente(s) selecionado(s).\n💡 Conecte o WhatsApp para envio automático, ou clique nos links abaixo:`,
      links);
  }
}

// ==============================================
//  CONFIGURAÇÕES – Modo de Servidor
// ==============================================

function carregarTelaConfiguracoes() {
  const cardAuto   = document.getElementById('cfg-card-auto');
  const cardManual = document.getElementById('cfg-card-manual');
  const badge      = document.getElementById('cfg-mode-badge');
  const autoUrl    = document.getElementById('cfg-auto-url');

  if (!isElectron()) {
    // Browser → modo automático cloud
    if (cardAuto)   cardAuto.style.display   = 'block';
    if (cardManual) cardManual.style.display  = 'none';
    if (autoUrl)    autoUrl.textContent       = window.location.origin;
    if (badge) {
      badge.textContent = `☁️ Google Cloud: ${window.location.origin}`;
      badge.className   = 'cfg-badge cfg-badge-cloud';
    }
    return;
  }

  // Electron → modo manual
  if (cardAuto)   cardAuto.style.display   = 'none';
  if (cardManual) cardManual.style.display  = 'block';

  const mode = localStorage.getItem('tc_server_mode') || 'local';
  const url  = localStorage.getItem('tc_server_url')  || '';

  const radioLocal = document.getElementById('cfg-mode-local');
  const radioCloud = document.getElementById('cfg-mode-cloud');
  const urlInput   = document.getElementById('cfg-server-url');
  const urlRow     = document.getElementById('cfg-url-row');

  if (radioLocal) radioLocal.checked = (mode === 'local');
  if (radioCloud) radioCloud.checked = (mode === 'cloud');
  if (urlInput)   urlInput.value     = url;
  if (urlRow)     urlRow.style.display = (mode === 'cloud') ? 'flex' : 'none';
  if (badge) {
    badge.textContent = (mode === 'cloud' && url) ? `☁️ Google Cloud: ${url}` : '💻 Local (este computador)';
    badge.className   = 'cfg-badge ' + (mode === 'cloud' ? 'cfg-badge-cloud' : 'cfg-badge-local');
  }
}

function cfgTrocarModo(modo) {
  const urlRow = document.getElementById('cfg-url-row');
  if (urlRow) urlRow.style.display = (modo === 'cloud') ? 'flex' : 'none';
}

function salvarConfiguracaoServidor() {
  const mode   = document.querySelector('input[name="cfg-mode"]:checked')?.value || 'local';
  const urlRaw = (document.getElementById('cfg-server-url')?.value || '').trim().replace(/\/$/, '');

  if (mode === 'cloud' && !urlRaw) {
    alert('⚠️ Informe a URL do servidor Oracle Cloud.\nEx: https://129.80.10.5:3000');
    return;
  }

  localStorage.setItem('tc_server_mode', mode);
  if (mode === 'cloud') localStorage.setItem('tc_server_url', urlRaw);

  // Reconecta com o novo API_BASE
  API_BASE = getAPIBase();
  if (socket) { socket.disconnect(); socket = null; }
  iniciarSocket();

  carregarTelaConfiguracoes();

  const msg = mode === 'cloud'
    ? `✅ Conectando ao servidor Oracle Cloud:\n${urlRaw}`
    : '✅ Usando servidor local (este computador).';
  alert(msg);
}
