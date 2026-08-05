// =============================================
//  Tech Corretor – app.js
//  Dados de exemplo + toda a lógica da interface
// =============================================

// ---- Servidor backend ----
// Detecta automaticamente o ambiente:
//   • Electron (desktop) → usa servidor local (window.location.origin = localhost)
//   • Browser (acesso via IP/cloud) → usa o próprio servidor de origem
//   • Configuração manual nas Configurações sobrescreve apenas no Electron
function isElectron() {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

function getAPIBase() {
  if (isElectron()) {
    // App desktop: verifica se usuário configurou cloud manualmente
    const mode = localStorage.getItem('tc_server_mode') || 'local';
    if (mode === 'cloud') {
      const url = (localStorage.getItem('tc_server_url') || '').trim().replace(/\/$/, '');
      if (url) return url;
    }
    // Padrão: servidor local embutido no Electron
    return window.location.origin;
  }
  // Browser (iPhone, PC via IP): a origem JÁ É o servidor na nuvem
  return window.location.origin;
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
let paginaAtual = 1;
const ITENS_POR_PAGINA = 30;

// ---- Inicialização ----
document.addEventListener("DOMContentLoaded", () => {
  iniciarSocket();
  sincronizarSwitchAntiBan();

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
  carregarTransmissoes();
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

  if (dados.length === 0) { aviso.style.display = "flex"; renderizarPaginacao(0); return; }
  aviso.style.display = "none";

  // Garantir página válida
  const totalPaginas = Math.ceil(dados.length / ITENS_POR_PAGINA);
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  if (paginaAtual < 1) paginaAtual = 1;

  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const paginaDados = dados.slice(inicio, inicio + ITENS_POR_PAGINA);

  paginaDados.forEach(r => {
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

  renderizarPaginacao(dados.length);
}

// ---- Paginação ----
function renderizarPaginacao(total) {
  const container = document.getElementById("paginacao");
  if (!container) return;
  const totalPaginas = Math.ceil(total / ITENS_POR_PAGINA);
  if (totalPaginas <= 1) { container.innerHTML = ""; return; }

  const inicioItem = (paginaAtual - 1) * ITENS_POR_PAGINA + 1;
  const fimItem    = Math.min(paginaAtual * ITENS_POR_PAGINA, total);

  let html = `<span class="paginacao-info">Exibindo ${inicioItem}–${fimItem} de ${total}</span><div class="paginacao-btns">`;
  html += `<button class="pag-btn" onclick="irParaPagina(1)" ${paginaAtual===1?'disabled':''} title="Primeira">«</button>`;
  html += `<button class="pag-btn" onclick="irParaPagina(${paginaAtual-1})" ${paginaAtual===1?'disabled':''} title="Anterior">‹</button>`;

  const p1 = Math.max(1, paginaAtual - 2);
  const p2 = Math.min(totalPaginas, paginaAtual + 2);
  if (p1 > 1) html += `<span class="pag-ellipsis">…</span>`;
  for (let i = p1; i <= p2; i++) {
    html += `<button class="pag-btn${i===paginaAtual?' pag-btn-active':''}" onclick="irParaPagina(${i})">${i}</button>`;
  }
  if (p2 < totalPaginas) html += `<span class="pag-ellipsis">…</span>`;

  html += `<button class="pag-btn" onclick="irParaPagina(${paginaAtual+1})" ${paginaAtual===totalPaginas?'disabled':''} title="Próxima">›</button>`;
  html += `<button class="pag-btn" onclick="irParaPagina(${totalPaginas})" ${paginaAtual===totalPaginas?'disabled':''} title="Última">»</button>`;
  html += `</div>`;
  container.innerHTML = html;
}

function irParaPagina(pagina) {
  const totalPaginas = Math.ceil(dadosFiltrados.length / ITENS_POR_PAGINA);
  paginaAtual = Math.max(1, Math.min(pagina, totalPaginas));
  renderizarTabela(dadosFiltrados);
  document.querySelector('.table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    base = base.filter(r => Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(termo)));
  }

  dadosFiltrados = base;
  paginaAtual = 1;
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
function fecharModal() {
  document.getElementById("modalMsg").style.display = "none";
  // Fechar o modal NÃO cancela o job em background — ele continua enviando
  // (o usuário pode reabrir o disparo depois ou apenas deixar rodando).
  // Apenas escondemos o botão de cancelar já que o modal está fechado.
  const btnCancelar = document.getElementById("disparo-cancelar-btn");
  if (btnCancelar) btnCancelar.style.display = "none";
}

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
  // Limpa busca anterior ao abrir o modal
  const buscaInput = document.getElementById("disparo-busca");
  if (buscaInput) buscaInput.value = "";
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
function storageExcedido(extraBytes = 0) {
  if (!userData) return false;
  const usado = (userData.storageUsed || 0) + extraBytes;
  const limite = userData.storageLimit || 10 * 1024 * 1024 * 1024;
  return usado > limite;
}

async function salvarCliente(e) {
  e.preventDefault();
  if (!validarForm()) return;

  const idx = parseInt(document.getElementById("clienteIndex").value);
  if (idx === -1 && storageExcedido(ESTIMATIVA_CLIENTE)) {
    mostrarToast("❌ Armazenamento cheio. Entre em contato com o administrador.", "err");
    return;
  }
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
      await atualizarStorageUsado(ESTIMATIVA_CLIENTE);
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
    await atualizarStorageUsado(-ESTIMATIVA_CLIENTE);
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

      // Auto-conectar: só aciona se estiver totalmente desconectado ou com erro.
      // Se o servidor já iniciou o WhatsApp automaticamente (conectando/autenticado),
      // não envia wa:iniciar de novo para evitar chamadas duplicadas.
      if (!window._waAutoConnectDone) {
        window._waAutoConnectDone = true;
        if (data.status === "desconectado" || data.status === "erro") {
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

    // ---- Progresso de disparos em lote (jobs em background no servidor) ----
    socket.on("disparo:progresso", (info) => handleDisparoProgresso(info));
    socket.on("disparo:concluido", (info) => handleDisparoConcluido(info));

    // ---- Estado do switch anti-ban (sincroniza entre abas/dispositivos) ----
    socket.on("anti-ban:status", (status) => atualizarSwitchAntiBan(status.ativo));

    // ---- Diagnóstico remoto: erros do backend (WhatsApp) gravados no Firestore ----
    socket.on("diag:evento", (evento) => registrarDiagnostico(evento));

  } catch(e) {
    socket = null;
  }
}

// ==============================================
//  DIAGNÓSTICO REMOTO (telemetria de erros)
// ==============================================
//
// O backend (server.js) roda localmente na máquina do cliente e não tem como
// gravar direto no Firestore com segurança (não é seguro embutir uma
// credencial admin no instalador). Em vez disso, ele emite um evento via
// socket e o FRONTEND grava aqui — usando a conta Firebase já autenticada do
// corretor. Assim você consegue ver no Firebase Console o que está
// acontecendo na máquina de cada cliente, sem precisar pedir o log manualmente.

async function registrarDiagnostico(evento) {
  try {
    if (!currentUser || !db) return; // sem sessão logada, não há como identificar o corretor

    // Kill-switch: se telemetriaAtiva === false no doc do usuário, não grava nada.
    // Para desligar: no Firebase Console → users/{uid} → campo "telemetriaAtiva": false
    // Para religar: apague o campo ou coloque true.
    if (userData && userData.telemetriaAtiva === false) return;

    await db.collection("diagnosticos").add({
      tipo: evento.tipo,
      dados: evento.dados || {},
      timestampCliente: evento.timestamp || Date.now(),
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      usuarioUid: currentUser.uid,
      usuarioEmail: currentUser.email || null,
      plataforma: navigator.platform || "desconhecida",
      userAgent: navigator.userAgent || "desconhecido",
      appVersion: (window.APP_VERSION || "desconhecida"),
    });
  } catch (err) {
    // Nunca deixa o diagnóstico quebrar o app — só loga no console local
    console.error("Falha ao registrar diagnóstico no Firestore:", err.message);
  }
}

// ── Captura GLOBAL de erros do frontend (window.onerror + unhandledrejection) ──
// Qualquer erro JS não tratado no browser é capturado e gravado no Firestore
// com throttle/dedup para não inundar o banco com erros repetidos.
(function() {
  const _frontErros = new Map(); // assinatura → timestamp
  let _frontContador = 0;
  const _FRONT_LIMITE = 100; // max por sessão do browser

  function _frontDeveReportar(assinatura) {
    if (_frontContador >= _FRONT_LIMITE) return false;
    const agora = Date.now();
    const ultimo = _frontErros.get(assinatura);
    if (ultimo && agora - ultimo < 60000) return false; // dedup 60s
    _frontErros.set(assinatura, agora);
    _frontContador++;
    return true;
  }

  // Erros síncronos (throw, TypeError, ReferenceError, etc.)
  window.onerror = function(message, source, lineno, colno, error) {
    const msg = String(message || "");
    const assinatura = msg.slice(0, 100);
    if (_frontDeveReportar(assinatura)) {
      registrarDiagnostico({
        tipo: "frontend_erro",
        dados: {
          mensagem: msg.slice(0, 500),
          source: (source || "").split("/").pop(), // só o nome do arquivo, não path completo
          linha: lineno,
          coluna: colno,
          stack: (error?.stack || "").slice(0, 1000),
        },
        timestamp: Date.now(),
      });
    }
  };

  // Promises rejeitadas sem .catch()
  window.addEventListener("unhandledrejection", function(event) {
    const reason = event.reason;
    const msg = reason?.message || String(reason || "");
    const assinatura = "rej:" + msg.slice(0, 100);
    if (_frontDeveReportar(assinatura)) {
      registrarDiagnostico({
        tipo: "frontend_unhandled_rejection",
        dados: {
          mensagem: msg.slice(0, 500),
          stack: (reason?.stack || "").slice(0, 1000),
        },
        timestamp: Date.now(),
      });
    }
  });

  // Erros de rede (fetch/XHR falhando, imagens não carregando, scripts não carregando)
  window.addEventListener("error", function(event) {
    // Só captura erros de recurso (script, img, link), não erros JS (já pegos pelo onerror)
    if (event.target && event.target !== window && event.target.tagName) {
      const tag = event.target.tagName.toLowerCase();
      const src = event.target.src || event.target.href || "";
      const assinatura = "res:" + tag + ":" + src.slice(-80);
      if (_frontDeveReportar(assinatura)) {
        registrarDiagnostico({
          tipo: "frontend_recurso_falhou",
          dados: {
            tag: tag,
            src: src.slice(0, 300),
          },
          timestamp: Date.now(),
        });
      }
    }
  }, true); // capture phase para pegar erros de recursos
})();

// ==============================================
//  SWITCH ANTI-BAN (dashboard)
// ==============================================

// Atualiza o visual do switch sem disparar o evento onchange de novo
function atualizarSwitchAntiBan(ativo) {
  const checkbox = document.getElementById("antiban-toggle");
  const label    = document.getElementById("antiban-switch-state");
  if (checkbox) checkbox.checked = !!ativo;
  if (label) {
    label.textContent = ativo ? "Ativado" : "Desativado";
    label.classList.toggle("off", !ativo);
  }
}

// Busca o estado atual do anti-ban no servidor (ao carregar o dashboard)
async function sincronizarSwitchAntiBan() {
  try {
    const res = await fetch(`${API_BASE}/api/anti-ban/status`);
    if (!res.ok) return;
    const data = await res.json();
    atualizarSwitchAntiBan(data.ativo);
  } catch (_) {
    // Sem conexão ainda — mantém o estado padrão (ativado) até o socket atualizar
  }
}

// Chamado pelo switch no topbar do dashboard
async function toggleAntiBan(ativo) {
  const checkbox = document.getElementById("antiban-toggle");

  // Desligar exige confirmação explícita — é uma decisão de risco
  if (!ativo) {
    const confirmado = confirm(
      "⚠️ Desligar o controle de envios remove TODAS as proteções contra bloqueio do WhatsApp:\n\n" +
      "• Sem pausas entre mensagens (envio em alta velocidade)\n" +
      "• Sem limite diário/por hora\n" +
      "• Sem simulação de digitação\n" +
      "• Envios liberados fora do horário comercial\n\n" +
      "Isso aumenta bastante o risco do número ser bloqueado pelo WhatsApp, " +
      "principalmente em disparos para muitos contatos.\n\n" +
      "Tem certeza que deseja desligar?"
    );
    if (!confirmado) {
      // Usuário cancelou — reverte o checkbox visualmente
      if (checkbox) checkbox.checked = true;
      return;
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/anti-ban/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo })
    });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const data = await res.json();
    atualizarSwitchAntiBan(data.ativo);
    mostrarToast(
      data.ativo ? "🛡️ Controle de envios ativado" : "⚠️ Controle de envios desativado — envios sem proteção",
      data.ativo ? "ok" : "err"
    );
  } catch (err) {
    // Falha ao salvar no servidor — reverte o switch para o estado anterior
    if (checkbox) checkbox.checked = !ativo;
    mostrarToast("Não foi possível alterar o anti-ban (verifique a conexão)", "err");
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

  // Bottom nav WA dot
  const bnavDot = document.getElementById("bnav-wa-dot");
  if (bnavDot) bnavDot.className = "bnav-wa-dot " + e.dot;

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
  // Limpa busca ao trocar de sugestão
  const buscaInput = document.getElementById("disparo-busca");
  if (buscaInput) buscaInput.value = "";

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
    msgFn = r => `Feliz aniversário, {nome}! 🎉 A equipe LF Imóveis deseja um dia incrível para você!`;
  } else if (tipo === "contrato_vencido") {
    clientes = todosOsDados.filter(isVencido);
    msgFn = r => `Olá, {nome}! Seu contrato do apartamento {apartamento} venceu em {terminoContrato}. Entre em contato para renovação.`;
  } else if (tipo === "ano_novo") {
    clientes = todosOsDados;
    msgFn = r => `Feliz Ano Novo, {nome}! 🎆 A equipe LF Imóveis agradece sua confiança e deseja realizações incríveis!`;
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

// ---- Estado do job de disparo em andamento (para progresso via socket) ----
let disparoJobAtual   = null; // jobId em andamento (ou null)
let disparoClientesRef = [];  // lista de clientes na ordem enviada (para mapear índice → linha)
let _ultimosProgressos = []; // buffer dos últimos eventos de progresso (para replay ao abrir modal)

function formatarTempo(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m} min`;
}

// Atualiza o banner de status no topo da lista (pausa, aguardando limite, etc.)
function atualizarBannerDisparo(html, tipo = "info") {
  let banner = document.getElementById("disparo-status-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "disparo-status-banner";
    const modalTexto = document.getElementById("modalTexto");
    modalTexto.after(banner);
  }
  banner.className = `send-status-banner send-status-${tipo}`;
  banner.innerHTML = html;
}

function removerBannerDisparo() {
  const banner = document.getElementById("disparo-status-banner");
  if (banner) banner.remove();
}

async function enviarViaBackend(titulo, clientes, msgFn, fotos = []) {
  // Fecha qualquer modal aberto (disparo, msg, etc.)
  document.getElementById("modalDisparo").style.display = "none";
  document.getElementById("modalMsg").style.display = "none";

  // ── Criar transmissão no Firestore ──
  const fotosArray = Array.isArray(fotos) ? fotos : (fotos ? [fotos] : []);
  const payload = clientes.map(r => ({ telefone: r.telefone, mensagem: msgFn(r), nome: r.nome }));

  const destinatarios = clientes.map(r => ({
    telefone: r.telefone,
    nome: r.nome || "",
    apartamento: r.apartamento || "",
    status: "pendente",
    erro: null,
    enviadoEm: null,
  }));

  let transmissaoId = null;
  let midiasUrls = []; // URLs das mídias no Storage (para persistir e reenviar)

  try {
    if (currentUser && db) {
      // Upload das mídias para o Firebase Storage (se houver)
      if (fotosArray.length > 0) {
        mostrarToast("Enviando mídias para o servidor...", "info");
        for (const foto of fotosArray) {
          try {
            const mimeMatch = foto.match(/^data:([^;]+);/);
            const mimetype = mimeMatch ? mimeMatch[1] : "application/octet-stream";
            const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") || "bin";
            const prefix = mimetype.includes("pdf") ? "pdf" : mimetype.startsWith("video/") ? "video" : "foto";
            const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const ref = storage.ref(`transmissoes/${currentUser.uid}/${fileName}`);
            const snapshot = await ref.putString(foto, "data_url");
            const url = await snapshot.ref.getDownloadURL();
            midiasUrls.push({ url, type: mimetype, name: fileName });
          } catch (uploadErr) {
            console.error("Erro ao fazer upload de mídia:", uploadErr.message);
          }
        }
      }

      const docRef = await db.collection("transmissoes").add({
        titulo,
        status: "em_andamento",
        criadaEm: firebase.firestore.FieldValue.serverTimestamp(),
        totalDestinatarios: clientes.length,
        enviados: 0,
        erros: 0,
        pendentes: clientes.length,
        mensagemTemplate: payload.length > 0 ? payload[0].mensagem : "",
        midias: midiasUrls, // salva URLs (não o base64)
        destinatarios,
        usuarioUid: currentUser.uid,
        usuarioEmail: currentUser.email || null,
        appVersion: window.APP_VERSION || "desconhecida",
      });
      transmissaoId = docRef.id;
      console.log("📋 Transmissão criada:", transmissaoId);

      const bytesEstimados = 500 + (clientes.length * 200);
      await atualizarStorageUsado(bytesEstimados);
    } else {
      console.warn("⚠️ Transmissão não criada: currentUser=", !!currentUser, "db=", !!db);
      mostrarToast("Erro: não foi possível registrar a transmissão", "err");
      return;
    }
  } catch (err) {
    console.error("❌ Erro ao criar transmissão no Firestore:", err.message);
    mostrarToast("Erro ao registrar transmissão: " + err.message, "err");
    return;
  }

  // ── Navega para aba Transmissões e abre o modal de detalhes ──
  irPara("transmissoes");
  // Pequeno delay para o onSnapshot capturar o novo doc antes de abrir
  setTimeout(() => abrirDetalheTransmissao(transmissaoId), 500);

  // ── Chama o backend para iniciar o envio em background ──
  window._transmissaoAtual = transmissaoId;
  window._transmissaoIndicesPendentes = null;
  disparoClientesRef = clientes;

  let data;
  try {
    const res = await fetch(`${API_BASE}/api/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagens: payload, fotos: midiasUrls.length > 0 ? midiasUrls.map(m => m.url) : fotosArray, transmissaoId })
    });

    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const e = await res.json(); errMsg = e.erro || errMsg; } catch(_) {}
      throw new Error(errMsg);
    }

    data = await res.json();
  } catch (err) {
    mostrarToast("Falha ao iniciar envio: " + err.message, "err");
    if (transmissaoId && db) {
      try { await db.collection("transmissoes").doc(transmissaoId).update({ status: "pausada" }); } catch(_) {}
    }
    return;
  }

  disparoJobAtual = data.jobId;
}

// ── Retomar transmissão pendente/pausada ──
async function retomarTransmissao(transmissaoId, midiasExternas) {
  if (!currentUser || !db) return mostrarToast("Faça login primeiro", "err");
  if (waStatus !== "pronto") return mostrarToast("Conecte o WhatsApp primeiro", "err");

  let doc;
  try {
    doc = await db.collection("transmissoes").doc(transmissaoId).get();
  } catch (err) {
    return mostrarToast("Erro ao carregar transmissão", "err");
  }
  if (!doc.exists) return mostrarToast("Transmissão não encontrada", "err");

  const trans = doc.data();

  // Filtra apenas os pendentes (não importa o status salvo — se tem pendentes, retoma)
  const pendentes = [];
  const indicesPendentes = [];
  trans.destinatarios.forEach((d, i) => {
    if (d.status === "pendente") {
      pendentes.push(d);
      indicesPendentes.push(i);
    }
  });

  if (pendentes.length === 0) {
    mostrarToast("Todos os destinatários já foram processados", "ok");
    try { await db.collection("transmissoes").doc(transmissaoId).update({ status: "concluida" }); } catch(_) {}
    return;
  }

  // Navega para transmissões e abre o modal de detalhes (progresso em tempo real)
  // Se o modal já está aberto para essa transmissão, atualiza a UI in-place sem fechar/reabrir
  const modalJaAberto = _transDetalheId === transmissaoId &&
    document.getElementById("modalTransmissao")?.style.display !== "none";

  if (modalJaAberto) {
    // Atualiza status badge para "Enviando..."
    const statusEl = document.getElementById("trans-detalhe-status");
    if (statusEl) { statusEl.className = "trans-status trans-status-progress"; statusEl.textContent = "📤 Enviando..."; }
    // Mostra botão Parar, oculta Reenviar e Continuar
    document.getElementById("trans-btn-parar").style.display = "inline-flex";
    document.getElementById("trans-btn-reenviar").style.display = "none";
    document.getElementById("trans-btn-continuar").style.display = "none";
    // Mostra banner de progresso
    const progressoEl = document.getElementById("trans-detalhe-progresso");
    if (progressoEl) {
      progressoEl.style.display = "block";
      progressoEl.className = "trans-detalhe-progresso send-status-banner send-status-info";
      progressoEl.innerHTML = '<span class="trans-dest-spinner"></span> Iniciando envio...';
    }
    // Atualiza lista de destinatários (todos marcados como pendente)
    if (_transDetalheData?.destinatarios) {
      _renderizarDestinatariosModal(_transDetalheData.destinatarios, true);
    }
  } else {
    irPara("transmissoes");
    setTimeout(() => abrirDetalheTransmissao(transmissaoId), 300);
  }

  window._transmissaoAtual = transmissaoId;
  window._transmissaoIndicesPendentes = indicesPendentes;
  disparoClientesRef = pendentes;

  // Atualiza status para em_andamento
  try { await db.collection("transmissoes").doc(transmissaoId).update({ status: "em_andamento" }); } catch(_) {}

  // Mídias: usa as passadas como parâmetro ou as salvas no Firestore (extrai URLs)
  let fotosParaEnviar = [];
  if (Array.isArray(midiasExternas) && midiasExternas.length > 0) {
    fotosParaEnviar = midiasExternas;
  } else if (Array.isArray(trans.midias) && trans.midias.length > 0) {
    // midias pode ser array de objetos {url, type, name} ou array de strings
    fotosParaEnviar = trans.midias.map(m => typeof m === "object" ? m.url : m).filter(Boolean);
  }

  // Monta payload só dos pendentes
  const payload = pendentes.map(r => ({ telefone: r.telefone, mensagem: trans.mensagemTemplate, nome: r.nome }));

  let data;
  try {
    const res = await fetch(`${API_BASE}/api/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagens: payload, fotos: fotosParaEnviar, transmissaoId })
    });
    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const e = await res.json(); errMsg = e.erro || errMsg; } catch(_) {}
      throw new Error(errMsg);
    }
    data = await res.json();
  } catch (err) {
    mostrarToast("Falha ao retomar: " + err.message, "err");
    try { await db.collection("transmissoes").doc(transmissaoId).update({ status: "pausada" }); } catch(_) {}
    return;
  }

  disparoJobAtual = data.jobId;
}

// Cancela o disparo em andamento (chamado pelo botão no modal)
async function cancelarDisparoAtual() {
  if (!disparoJobAtual) return;
  try {
    await fetch(`${API_BASE}/api/send-batch/${disparoJobAtual}/cancelar`, { method: "POST" });
    atualizarBannerDisparo("⏹️ Cancelando... as mensagens já enviadas não serão desfeitas.", "warn");
  } catch (_) {
    mostrarToast("Não foi possível cancelar (verifique a conexão)", "err");
  }
}

// ---- Listeners globais de progresso do disparo ----
function handleDisparoProgresso(info) {
  if (!info || info.jobId !== disparoJobAtual) return;

  // Atualiza item visual individual (resultado final: enviado/erro)
  if (typeof info.idx === "number" && info.itemStatus) {
    const el = document.getElementById("send-status-" + info.idx);
    const item = document.getElementById("send-item-" + info.idx);
    if (el) {
      if (info.itemStatus === "enviado") {
        el.innerHTML = "✅ Enviado";
        el.className = "send-item-status send-ok";
      } else if (info.itemStatus === "erro") {
        el.innerHTML = "❌ Erro";
        el.className = "send-item-status send-err";
        el.title = info.itemErro || "";
        if (item && !item.nextElementSibling?.classList?.contains("send-item-error-detail")) {
          const det = document.createElement("div");
          det.className = "send-item-error-detail";
          det.textContent = `↳ ${info.itemErro || "erro desconhecido"}`;
          item.after(det);
        }
      }
    }
    // Remove destaque do item concluído
    if (item) item.classList.remove("trans-dest-active");

    // Imediatamente destaca o próximo item com spinner (sem esperar evento de pausa)
    const nextIdx = info.idx + 1;
    if (nextIdx < info.total) {
      const nextEl = document.getElementById("send-status-" + nextIdx);
      const nextItem = document.getElementById("send-item-" + nextIdx);
      if (nextEl && !nextEl.className.includes("send-ok") && !nextEl.className.includes("send-err")) {
        nextEl.innerHTML = '<span class="trans-dest-spinner"></span> Próximo...';
      }
      if (nextItem) nextItem.classList.add("trans-dest-active");
    }

    // Atualiza o Firestore em tempo real (destinatarios[idx].status)
    _atualizarDestinatarioFirestore(info.idx, info.itemStatus, info.itemErro);
  }

  // Atualiza item sendo processado agora (verificando/enviando) — com spinner + destaque
  if (typeof info.idx === "number" && (info.status === "verificando_numero" || info.status === "enviando") && !info.itemStatus) {
    const el = document.getElementById("send-status-" + info.idx);
    const item = document.getElementById("send-item-" + info.idx);
    if (el) {
      el.innerHTML = info.status === "enviando"
        ? '<span class="trans-dest-spinner"></span> Enviando...'
        : '<span class="trans-dest-spinner"></span> Verificando...';
      el.className = "send-item-status send-pending";
    }
    if (item) item.classList.add("trans-dest-active");
  }

  // Banner de status
  if (info.status === "aguardando_limite") {
    atualizarBannerDisparo(
      `⏸️ Pausado temporariamente — ${info.motivo}${info.aguardarMs ? ` (retoma em ~${formatarTempo(info.aguardarMs)})` : ""}`,
      "warn"
    );
  } else if (info.status === "pausa_curta") {
    atualizarBannerDisparo(`⏳ Aguardando ${formatarTempo(info.aguardarMs)} antes do próximo envio...`, "info");
  } else if (info.status === "pausado_definitivo") {
    atualizarBannerDisparo(`⏸️ ${info.motivo}`, "err");
  } else if (info.status === "cancelado") {
    atualizarBannerDisparo("⏹️ Envio cancelado pelo usuário.", "warn");
  } else if (!info.itemStatus) {
    removerBannerDisparo();
  }

  // Salva no buffer para replay quando o modal de transmissão abrir depois
  _ultimosProgressos.push(info);
  // Mantém só os últimos 50 eventos para não crescer demais
  if (_ultimosProgressos.length > 50) _ultimosProgressos.shift();

  // Atualiza também o banner do modal de detalhes (se estiver aberto para essa transmissão)
  _atualizarProgressoModalDetalhe(info);

  // Contador no topo
  document.getElementById("modalTexto").textContent =
    `Enviando... ${info.enviados} enviada(s), ${info.erros} com erro, ${info.total - info.processados} restante(s).`;
}

// Atualiza o banner de progresso dentro do modal de detalhes da transmissão
function _atualizarProgressoModalDetalhe(info) {
  const el = document.getElementById("trans-detalhe-progresso");
  if (!el) return;

  // Só mostra se o modal de detalhes está aberto E é a mesma transmissão
  const modalAberto = document.getElementById("modalTransmissao")?.style.display === "flex";
  const mesmaTransmissao = info.transmissaoId && _transDetalheId === info.transmissaoId;

  if (!modalAberto || !mesmaTransmissao) {
    el.style.display = "none";
    return;
  }

  el.style.display = "block";

  let html = "";
  let tipo = "info";

  if (info.status === "verificando_numero") {
    html = `🔎 Verificando número de <strong>${info.clienteAtual || ""}</strong>...`;
  } else if (info.status === "enviando") {
    html = `📤 Enviando para <strong>${info.clienteAtual || ""}</strong>...`;
  } else if (info.status === "pausa_curta") {
    html = `⏳ Aguardando ${formatarTempo(info.aguardarMs)} antes do próximo envio (proteção anti-bloqueio)...`;
  } else if (info.status === "aguardando_limite") {
    html = `⏸️ Pausado — ${info.motivo}${info.aguardarMs ? ` (retoma em ~${formatarTempo(info.aguardarMs)})` : ""}`;
    tipo = "warn";
  } else if (info.status === "cancelado") {
    html = `⏹️ Envio cancelado.`;
    tipo = "warn";
  } else if (info.itemStatus === "enviado") {
    html = `✅ Enviado para ${info.clienteAtual || ""}. Progresso: ${info.enviados}/${info.total}`;
  } else if (info.itemStatus === "erro") {
    html = `❌ Falha: ${info.itemErro || "erro"} — Progresso: ${info.enviados}/${info.total}`;
    tipo = "err";
  } else {
    html = `📤 Processando... ${info.enviados}/${info.total} enviada(s)`;
  }

  el.className = `trans-detalhe-progresso send-status-banner send-status-${tipo}`;
  el.innerHTML = html;

  // Atualiza o resumo
  const resumoEl = document.getElementById("trans-detalhe-resumo");
  if (resumoEl) {
    resumoEl.textContent = `${info.enviados} enviada(s) · ${info.erros} erro(s) · ${info.total - info.processados} pendente(s) — total ${info.total}`;
  }

  // Re-renderiza a lista de destinatários para refletir os status atualizados
  if (_transDetalheData && _transDetalheData.destinatarios) {
    if (info.itemStatus) {
      // Resultado final (enviado/erro) — sempre aplica
      const realIdx = window._transmissaoIndicesPendentes
        ? window._transmissaoIndicesPendentes[info.idx]
        : info.idx;
      if (typeof realIdx === "number" && _transDetalheData.destinatarios[realIdx]) {
        _transDetalheData.destinatarios[realIdx].status = info.itemStatus === "enviado" ? "enviado" : "erro";
        _transDetalheData.destinatarios[realIdx].erro = info.itemStatus === "erro" ? (info.itemErro || null) : null;
      }
    } else if (info.status === "verificando_numero" || info.status === "enviando") {
      // Status intermediário — só aplica se o destinatário ainda não tiver status final
      const realIdx = window._transmissaoIndicesPendentes
        ? window._transmissaoIndicesPendentes[info.idx]
        : info.idx;
      if (typeof realIdx === "number" && _transDetalheData.destinatarios[realIdx]) {
        const statusAtual = _transDetalheData.destinatarios[realIdx].status;
        // Não sobrescreve status finais com intermediários
        if (statusAtual !== "enviado" && statusAtual !== "erro") {
          _transDetalheData.destinatarios[realIdx].status = info.status === "enviando" ? "enviando" : "verificando";
        }
      }
    } else if (info.status === "pausa_curta" || info.status === "aguardando_limite") {
      // Durante a pausa, marca o PRÓXIMO item como "verificando" para dar sensação de progresso
      const nextIdx = info.idx !== undefined ? info.idx + 1 : info.processados;
      const realNextIdx = window._transmissaoIndicesPendentes
        ? window._transmissaoIndicesPendentes[nextIdx]
        : nextIdx;
      if (typeof realNextIdx === "number" && _transDetalheData.destinatarios[realNextIdx] && _transDetalheData.destinatarios[realNextIdx].status === "pendente") {
        _transDetalheData.destinatarios[realNextIdx].status = "verificando";
      }
    }
    _renderizarDestinatariosModal(_transDetalheData.destinatarios, true);
  }
}

function handleDisparoConcluido(info) {
  if (!info || info.jobId !== disparoJobAtual) return;
  disparoJobAtual = null;
  _ultimosProgressos = []; // limpa buffer ao concluir

  // Esconde banner de progresso do modal de detalhes
  const progressoEl = document.getElementById("trans-detalhe-progresso");
  if (progressoEl) { progressoEl.style.display = "none"; }

  // Restaura botões do modal de transmissão
  const btnParar = document.getElementById("trans-btn-parar");
  const btnReenviar = document.getElementById("trans-btn-reenviar");
  if (btnParar) btnParar.style.display = "none";
  if (btnReenviar) btnReenviar.style.display = "inline-flex";

  // Atualiza o modal de detalhes se estiver aberto
  if (_transDetalheData && info.transmissaoId && _transDetalheId === info.transmissaoId) {
    const statusEl = document.getElementById("trans-detalhe-status");
    if (statusEl) {
      statusEl.className = "trans-status trans-status-ok";
      statusEl.textContent = "✅ Concluída";
    }
    // Re-renderiza os destinatários com status final
    if (info.resultados && _transDetalheData.destinatarios) {
      const realIndices = window._transmissaoIndicesPendentes;
      info.resultados.forEach((r, i) => {
        const realIdx = realIndices ? realIndices[i] : i;
        if (typeof realIdx === "number" && _transDetalheData.destinatarios[realIdx]) {
          _transDetalheData.destinatarios[realIdx].status = r.ok ? "enviado" : "erro";
          _transDetalheData.destinatarios[realIdx].erro = r.ok ? null : (r.erro || null);
        }
      });
      _renderizarDestinatariosModal(_transDetalheData.destinatarios, true);
    }
    const resumoEl = document.getElementById("trans-detalhe-resumo");
    if (resumoEl && info.resultados) {
      const total = _transDetalheData.destinatarios?.length || 0;
      const enviados = _transDetalheData.destinatarios?.filter(d => d.status === "enviado").length || 0;
      const erros = _transDetalheData.destinatarios?.filter(d => d.status === "erro").length || 0;
      const pendentes = _transDetalheData.destinatarios?.filter(d => d.status === "pendente").length || 0;
      resumoEl.textContent = `${enviados} enviada(s) · ${erros} erro(s) · ${pendentes} pendente(s) — total ${total}`;

      // Se terminou com pendentes, mostra banner convidando a continuar
      if (pendentes > 0) {
        const progressoEl = document.getElementById("trans-detalhe-progresso");
        if (progressoEl) {
          progressoEl.style.display = "block";
          progressoEl.className = "trans-detalhe-progresso send-status-banner send-status-warn";
          progressoEl.innerHTML = `⏸️ Envio pausado — ${pendentes} destinatário(s) pendente(s). Clique em <strong>Continuar pendentes</strong> para retomar.`;
        }
        if (statusEl) {
          statusEl.className = "trans-status trans-status-warn";
          statusEl.textContent = "⏸️ Pausada";
        }
        document.getElementById("trans-btn-continuar").style.display = "inline-flex";
      }
    }
  }

  const btnCancelar = document.getElementById("disparo-cancelar-btn");
  if (btnCancelar) btnCancelar.style.display = "none";

  if (info.erro) {
    document.getElementById("modalTexto").innerHTML =
      `<span class="send-error-banner">❌ Falha no envio — ${info.erro}</span>`;
    _finalizarTransmissaoFirestore("pausada");
    return;
  }

  const resultados = info.resultados || [];
  let qtdOk = 0, qtdErr = 0, qtdPendente = 0;

  resultados.forEach((r, i) => {
    const el = document.getElementById("send-status-" + i);
    if (el) {
      if (r.ok) {
        el.textContent = "✅ Enviado";
        el.className = "send-item-status send-ok";
      } else {
        el.textContent = r.pendente ? "⏸️ Pendente" : "❌ Erro";
        el.className = r.pendente ? "send-item-status send-pending" : "send-item-status send-err";
      }
    }
    if (r.ok) qtdOk++;
    else if (r.pendente) qtdPendente++;
    else qtdErr++;
  });

  removerBannerDisparo();

  const partes = [];
  if (qtdOk > 0) partes.push(`✅ ${qtdOk} enviada(s)`);
  if (qtdErr > 0) partes.push(`❌ ${qtdErr} com erro`);
  if (qtdPendente > 0) partes.push(`⏸️ ${qtdPendente} pendente(s)`);

  const textoFinal = partes.join(" · ") || "Nenhuma mensagem processada.";
  const tipoClasse = qtdErr === 0 && qtdPendente === 0 ? "send-summary-ok" : qtdOk === 0 ? "send-summary-err" : "send-summary-warn";
  document.getElementById("modalTexto").innerHTML = `<span class="${tipoClasse}">${textoFinal}</span>`;

  // Finaliza transmissão no Firestore
  const statusFinal = qtdPendente > 0 ? "pausada" : "concluida";
  _finalizarTransmissaoFirestore(statusFinal);
}

// ── Helpers de persistência no Firestore ──
async function _atualizarDestinatarioFirestore(localIdx, status, erro) {
  const transmissaoId = window._transmissaoAtual;
  if (!transmissaoId || !db) return;

  try {
    // Se é uma retomada, o idx local não corresponde ao idx no doc original
    const realIdx = window._transmissaoIndicesPendentes
      ? window._transmissaoIndicesPendentes[localIdx]
      : localIdx;

    if (typeof realIdx !== "number") return;

    const docRef = db.collection("transmissoes").doc(transmissaoId);
    const doc = await docRef.get();
    if (!doc.exists) return;

    const data = doc.data();
    const dest = data.destinatarios;
    if (!dest || !dest[realIdx]) return;

    dest[realIdx].status = status === "enviado" ? "enviado" : "erro";
    dest[realIdx].erro = status === "erro" ? (erro || null) : null;
    dest[realIdx].enviadoEm = status === "enviado" ? new Date().toISOString() : null;

    const enviados = dest.filter(d => d.status === "enviado").length;
    const erros = dest.filter(d => d.status === "erro").length;
    const pendentes = dest.filter(d => d.status === "pendente").length;

    await docRef.update({ destinatarios: dest, enviados, erros, pendentes });

    // Atualiza a lista local em memória para refletir imediato na aba Transmissões
    const docLocal = _transmissoesTodas.find(t => t.id === transmissaoId);
    if (docLocal) {
      docLocal.enviados = enviados;
      docLocal.erros = erros;
      docLocal.pendentes = pendentes;
      docLocal.destinatarios = dest;
    }
  } catch (err) {
    console.error("Erro ao atualizar destinatário no Firestore:", err.message);
  }
}

async function _finalizarTransmissaoFirestore(statusFinal) {
  const transmissaoId = window._transmissaoAtual;
  if (!transmissaoId || !db) return;
  window._transmissaoAtual = null;
  window._transmissaoIndicesPendentes = null;

  try {
    await db.collection("transmissoes").doc(transmissaoId).update({ status: statusFinal });
  } catch (err) {
    console.error("Erro ao finalizar transmissão no Firestore:", err.message);
  }

  // Atualiza o doc local na lista em memória para refletir imediatamente
  const docLocal = _transmissoesTodas.find(t => t.id === transmissaoId);
  if (docLocal) {
    docLocal.status = statusFinal;
  }
  _renderizarTransmissoes();

  // Recarrega a lista de transmissões (onSnapshot vai sincronizar depois)
  carregarTransmissoes();
}

// ==============================================
//  PAINEL DE TRANSMISSÕES (dashboard)
// ==============================================

let _transmissoesListener = null;
let _transmissoesTodas = []; // todos os docs carregados
let _transmissoesPagina = 0; // página atual (0-indexed)
const _TRANS_POR_PAGINA = 30;

function carregarTransmissoes() {
  if (!currentUser || !db) return;

  // Executa auto-limpeza de transmissões com +7 dias (se switch ativado)
  _executarAutoDelete();

  // Listener em tempo real — carrega todas as transmissões do usuário
  if (_transmissoesListener) _transmissoesListener();

  _transmissoesListener = db.collection("transmissoes")
    .where("usuarioUid", "==", currentUser.uid)
    .orderBy("criadaEm", "desc")
    .limit(200) // máximo razoável em memória
    .onSnapshot(snap => {
      _transmissoesTodas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      _transmissoesPagina = 0;
      _renderizarTransmissoes();
    }, err => {
      console.error("Erro ao carregar transmissões:", err.message);
    });
}

function filtrarTransmissoes() {
  _transmissoesPagina = 0;
  _renderizarTransmissoes();
}

function transNavegar(direcao) {
  const filtradas = _getTransmissoesFiltradas();
  const maxPagina = Math.max(0, Math.ceil(filtradas.length / _TRANS_POR_PAGINA) - 1);
  _transmissoesPagina = Math.max(0, Math.min(maxPagina, _transmissoesPagina + direcao));
  _renderizarTransmissoes();
}

function _getTransmissoesFiltradas() {
  const termo = (document.getElementById("trans-pesquisa")?.value || "").toLowerCase().trim();
  if (!termo) return _transmissoesTodas;

  return _transmissoesTodas.filter(t => {
    const titulo = (t.titulo || "").toLowerCase();
    if (titulo.includes(termo)) return true;
    // Busca nos nomes/telefones dos destinatários
    const dests = t.destinatarios || [];
    return dests.some(d =>
      (d.nome || "").toLowerCase().includes(termo) ||
      (d.telefone || "").includes(termo)
    );
  });
}

function _renderizarTransmissoes() {
  const container = document.getElementById("transmissoes-lista");
  const vazio = document.getElementById("transmissoes-vazio");
  const countEl = document.getElementById("transmissoesCount");
  const infoEl = document.getElementById("trans-pagina-info");
  const btnAnt = document.getElementById("trans-btn-anterior");
  const btnProx = document.getElementById("trans-btn-proximo");

  const filtradas = _getTransmissoesFiltradas();
  const total = filtradas.length;

  if (countEl) countEl.textContent = total;

  if (total === 0) {
    container.innerHTML = "";
    if (vazio) { vazio.style.display = "flex"; container.appendChild(vazio); }
    if (infoEl) infoEl.textContent = "0 transmissões";
    if (btnAnt) btnAnt.disabled = true;
    if (btnProx) btnProx.disabled = true;
    return;
  }

  if (vazio) vazio.style.display = "none";

  const inicio = _transmissoesPagina * _TRANS_POR_PAGINA;
  const fim = Math.min(inicio + _TRANS_POR_PAGINA, total);
  const pagina = filtradas.slice(inicio, fim);

  if (infoEl) infoEl.textContent = `${inicio + 1}–${fim} de ${total}`;
  if (btnAnt) btnAnt.disabled = _transmissoesPagina === 0;
  if (btnProx) btnProx.disabled = fim >= total;

  container.innerHTML = pagina.map(t => {
    const id = t.id;
    const data = t.criadaEm ? t.criadaEm.toDate().toLocaleDateString("pt-BR") : "—";
    const hora = t.criadaEm ? t.criadaEm.toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    const total = t.totalDestinatarios || 0;
    const enviados = t.enviados || 0;
    const erros = t.erros || 0;
    const pendentes = t.pendentes || 0;
    const pct = total > 0 ? Math.round((enviados / total) * 100) : 0;

    const statusMap = {
      em_andamento: { label: "Enviando...", cls: "trans-status-progress", icon: "📤" },
      concluida:    { label: "Concluída",   cls: "trans-status-ok",       icon: "✅" },
      pausada:      { label: "Pausada",     cls: "trans-status-warn",     icon: "⏸️" },
      cancelada:    { label: "Cancelada",   cls: "trans-status-err",      icon: "⏹️" },
    };
    const s = statusMap[t.status] || statusMap.pausada;
    const podeContinuar = t.status === "pausada" && pendentes > 0;

    return `
      <div class="trans-item" onclick="abrirDetalheTransmissao('${id}')" style="cursor:pointer;">
        <div class="trans-item-header">
          <div class="trans-item-info">
            <span class="trans-item-titulo">${t.titulo || "Sem título"}</span>
            <span class="trans-item-data">${data} ${hora}</span>
          </div>
          <span class="trans-status ${s.cls}">${s.icon} ${s.label}</span>
        </div>
        <div class="trans-item-progress">
          <div class="trans-progress-bar">
            <div class="trans-progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="trans-progress-text">${enviados}/${total} enviadas${erros > 0 ? ` · ${erros} erro(s)` : ""}${pendentes > 0 ? ` · ${pendentes} pendente(s)` : ""}</span>
        </div>
        ${podeContinuar ? `<span class="trans-item-hint">Clique para continuar envio (${pendentes} restantes)</span>` : ""}
      </div>
    `;
  }).join("");
}

// ── Auto-limpeza de transmissões concluídas (após 7 dias) ──
// O switch fica salvo no localStorage do dispositivo.
// Quando ativado, a cada carregamento da página de transmissões, verifica se
// há transmissões concluídas há mais de 7 dias e as apaga automaticamente.

function _getAutoDeleteAtivo() {
  const val = localStorage.getItem("trans_autodelete");
  return val === null ? true : val === "true"; // default: ativado
}

function _syncAutoDeleteUI() {
  const ativo = _getAutoDeleteAtivo();
  const checkbox = document.getElementById("trans-autodelete-toggle");
  const label = document.getElementById("trans-autodelete-state");
  if (checkbox) checkbox.checked = ativo;
  if (label) {
    label.textContent = ativo ? "7 dias" : "Desativado";
    label.classList.toggle("off", !ativo);
  }
}

function toggleAutoDeleteTransmissoes(ativo) {
  localStorage.setItem("trans_autodelete", ativo ? "true" : "false");
  _syncAutoDeleteUI();
  mostrarToast(ativo ? "Auto-limpeza ativada (7 dias)" : "Auto-limpeza desativada", ativo ? "ok" : "info");
  if (ativo) _executarAutoDelete();
}

async function _executarAutoDelete() {
  if (!_getAutoDeleteAtivo() || !currentUser || !db) return;

  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    const snap = await db.collection("transmissoes")
      .where("usuarioUid", "==", currentUser.uid)
      .where("status", "==", "concluida")
      .get();

    let deletados = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const criadaEm = data.criadaEm ? data.criadaEm.toDate() : null;
      if (criadaEm && criadaEm < seteDiasAtras && !data.fixada) {
        const total = data.totalDestinatarios || 0;
        const midiasDel = Array.isArray(data.midias) ? data.midias : [];
        const bytesFotosDel = midiasDel.reduce((acc, f) => acc + (typeof f === 'string' ? f.length : 0), 0);
        const bytes = 500 + (total * 200) + bytesFotosDel;
        await doc.ref.delete();
        await atualizarStorageUsado(-bytes);
        deletados++;
      }
    }

    if (deletados > 0) {
      console.log(`🗑️ Auto-limpeza: ${deletados} transmissão(ões) com +7 dias excluída(s).`);
    }
  } catch (err) {
    console.error("Erro na auto-limpeza de transmissões:", err.message);
  }
}

// Sincroniza UI do switch ao carregar a página
document.addEventListener("DOMContentLoaded", () => _syncAutoDeleteUI());

// ── Variável global: transmissão selecionada no modal de detalhes ──
let _transDetalheId = null;
let _transDetalheData = null;

// Abre o modal com os detalhes de uma transmissão específica
async function abrirDetalheTransmissao(transmissaoId) {
  if (!db) return;

  let doc;
  try {
    doc = await db.collection("transmissoes").doc(transmissaoId).get();
  } catch (err) {
    return mostrarToast("Erro ao carregar transmissão", "err");
  }
  if (!doc.exists) return mostrarToast("Transmissão não encontrada", "err");

  _transDetalheId = transmissaoId;
  _transDetalheData = doc.data();
  const t = _transDetalheData;

  // Título (modo display com botão editar)
  document.getElementById("trans-titulo-display").textContent = t.titulo || "Sem título";
  document.getElementById("trans-detalhe-titulo-input").value = t.titulo || "";
  document.getElementById("trans-titulo-display").parentElement.style.display = "flex";
  document.getElementById("trans-detalhe-titulo-input").style.display = "none";

  // Status badge
  const statusMap = {
    em_andamento: { label: "Enviando...", cls: "trans-status-progress", icon: "📤" },
    concluida:    { label: "Concluída",   cls: "trans-status-ok",       icon: "✅" },
    pausada:      { label: "Pausada",     cls: "trans-status-warn",     icon: "⏸️" },
    cancelada:    { label: "Cancelada",   cls: "trans-status-err",      icon: "⏹️" },
  };
  const s = statusMap[t.status] || statusMap.pausada;
  const statusEl = document.getElementById("trans-detalhe-status");
  statusEl.className = `trans-status ${s.cls}`;
  statusEl.textContent = `${s.icon} ${s.label}`;

  // Data
  const data = t.criadaEm ? t.criadaEm.toDate().toLocaleDateString("pt-BR") : "—";
  const hora = t.criadaEm ? t.criadaEm.toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  document.getElementById("trans-detalhe-data").textContent = `${data} ${hora}`;

  // Resumo
  const total = t.totalDestinatarios || 0;
  const enviados = t.enviados || 0;
  const erros = t.erros || 0;
  const pendentes = t.pendentes || 0;
  document.getElementById("trans-detalhe-resumo").textContent =
    `${enviados} enviada(s) · ${erros} erro(s) · ${pendentes} pendente(s) — total ${total}`;

  // Mensagem (editável)
  document.getElementById("trans-detalhe-mensagem").value = t.mensagemTemplate || "";

  // Mídias salvas (carrega previews das fotos/vídeos da transmissão)
  transMidias = Array.isArray(t.midias) ? [...t.midias] : [];
  renderizarPreviewMidiasTransmissao();

  // Switch fixar (impede auto-limpeza de 7 dias)
  document.getElementById("trans-fixar-toggle").checked = !!t.fixada;

  // Botões de ação
  document.getElementById("trans-btn-parar").style.display = t.status === "em_andamento" ? "inline-flex" : "none";

  // Se tem pendentes, SEMPRE mostra o botão de continuar (independente do status salvo)
  // Isso cobre o caso de status "concluida" mas com pendentes (job morreu no meio)
  const mostrarContinuar = pendentes > 0 && t.status !== "em_andamento";
  document.getElementById("trans-btn-continuar").style.display = mostrarContinuar ? "inline-flex" : "none";

  // Corrige inconsistência: se tem pendentes mas status é "concluida", marca como pausada
  if (pendentes > 0 && (t.status === "concluida" || t.status === "cancelada")) {
    t.status = "pausada";
    _transDetalheData.status = "pausada";
    const statusEl = document.getElementById("trans-detalhe-status");
    if (statusEl) { statusEl.className = "trans-status trans-status-warn"; statusEl.textContent = "⏸️ Pausada"; }
    // Atualiza no Firestore
    if (db) db.collection("transmissoes").doc(transmissaoId).update({ status: "pausada" }).catch(() => {});
  }

  // Renderiza lista de destinatários
  _renderizarDestinatariosModal(t.destinatarios || [], true);

  document.getElementById("modalTransmissao").style.display = "flex";

  // Se há um job ativo para essa transmissão, mostra banner de progresso
  // e replays os eventos buffered para refletir o estado atual
  if (disparoJobAtual && t.status === "em_andamento") {
    // Mostra banner de progresso
    const progressoEl = document.getElementById("trans-detalhe-progresso");
    if (progressoEl) {
      progressoEl.style.display = "block";
      progressoEl.className = "trans-detalhe-progresso send-status-banner send-status-info";
      progressoEl.innerHTML = '<span class="trans-dest-spinner"></span> Processando envio em andamento...';
    }
    // Replay dos eventos buffered para corrigir o estado visual dos itens
    const eventosReplay = _ultimosProgressos.filter(e => e.transmissaoId === transmissaoId);
    eventosReplay.forEach(e => _atualizarProgressoModalDetalhe(e));
  }

  // Se está pausada com pendentes, mostra banner convidando a continuar
  if ((t.status === "pausada" || t.status === "cancelada") && pendentes > 0) {
    const progressoEl = document.getElementById("trans-detalhe-progresso");
    if (progressoEl) {
      progressoEl.style.display = "block";
      progressoEl.className = "trans-detalhe-progresso send-status-banner send-status-warn";
      progressoEl.innerHTML = `⏸️ Envio pausado — ${pendentes} destinatário(s) pendente(s). Clique em <strong>Continuar pendentes</strong> para retomar.`;
    }
  }
}

function fecharModalTransmissao() {
  document.getElementById("modalTransmissao").style.display = "none";
  _transDetalheId = null;
  _transDetalheData = null;
  transMidias = [];
  renderizarPreviewMidiasTransmissao();
}

// ---- Mídias do modal de transmissão ----
let transMidias = []; // data URLs de imagens/vídeos para reenvio/continuação

function adicionarMidiaTransmissao(input) {
  const files = Array.from(input.files || []);
  files.forEach(file => {
    if (transMidias.length >= 5) {
      alert("Máximo de 5 arquivos por transmissão.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      transMidias.push(e.target.result);
      renderizarPreviewMidiasTransmissao();
    };
    reader.readAsDataURL(file);
  });
  input.value = ""; // permite selecionar o mesmo arquivo de novo
}

function removerMidiaTransmissao(idx) {
  transMidias.splice(idx, 1);
  renderizarPreviewMidiasTransmissao();
}

function renderizarPreviewMidiasTransmissao() {
  const lista = document.getElementById("trans-midia-list");
  if (!lista) return;
  lista.innerHTML = "";
  transMidias.forEach((midia, idx) => {
    // Suporta tanto objetos {url, type, name} quanto strings (data URL ou URL)
    const url = typeof midia === "object" ? midia.url : midia;
    const type = typeof midia === "object" ? (midia.type || "") : "";
    // Nome real do arquivo: usa o salvo (midia.name) ou extrai da URL/data URL
    const nomeArquivo = typeof midia === "object" && midia.name
      ? midia.name
      : (url.split("/").pop() || "").split("?")[0].split("#")[0] || "arquivo";

    const isPdf = type.includes("pdf") || url.includes(".pdf");
    const isVideo = type.startsWith("video/") || url.includes(".mp4") || url.includes(".mov");
    const isImage = type.startsWith("image/") || url.match(/\.(jpg|jpeg|png|gif|webp)/i);

    const item = document.createElement("div");
    item.className = "disparo-midia-item";
    if (isPdf) {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-pdf">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/><text x="7" y="17" font-size="5" fill="#fff" font-weight="bold">PDF</text></svg>
        </div>
        <span class="disparo-midia-nome" title="${nomeArquivo}">${nomeArquivo}</span>
        <button class="disparo-midia-remove" onclick="removerMidiaTransmissao(${idx})" title="Remover">✕</button>
      `;
    } else if (isVideo) {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-video">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <span class="disparo-midia-nome" title="${nomeArquivo}">${nomeArquivo}</span>
        <button class="disparo-midia-remove" onclick="removerMidiaTransmissao(${idx})" title="Remover">✕</button>
      `;
    } else if (isImage) {
      item.innerHTML = `
        <img class="disparo-midia-thumb" src="${url}" alt="mídia ${idx + 1}">
        <button class="disparo-midia-remove" onclick="removerMidiaTransmissao(${idx})" title="Remover">✕</button>
      `;
    } else {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-doc">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/></svg>
        </div>
        <span class="disparo-midia-nome" title="${nomeArquivo}">${nomeArquivo}</span>
        <button class="disparo-midia-remove" onclick="removerMidiaTransmissao(${idx})" title="Remover">✕</button>
      `;
    }
    lista.appendChild(item);
  });
}


// Renderiza a lista de destinatários dentro do modal
function _renderizarDestinatariosModal(destinatarios, editavel) {
  const container = document.getElementById("trans-detalhe-destinatarios");

  if (!destinatarios || destinatarios.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:.82rem;padding:10px 0;">Nenhum destinatário.</p>`;
    return;
  }

  container.innerHTML = destinatarios.map((d, i) => {
    const statusLabel = d.status === "enviado" ? "✅ Enviado"
      : d.status === "erro" ? "❌ Erro"
      : d.status === "enviando" ? '<span class="trans-dest-spinner"></span> Enviando...'
      : d.status === "verificando" ? '<span class="trans-dest-spinner"></span> Verificando...'
      : "⏳ Aguardando";
    const statusClass = d.status === "enviado" ? "send-ok" : d.status === "erro" ? "send-err" : "send-pending";
    const erroText = d.erro ? `<span class="trans-dest-erro">↳ ${d.erro}</span>` : "";
    const retryBtn = d.status === "erro" ? `<button class="trans-dest-retry" onclick="transReenviarIndividual(${i})" title="Reenviar">🔄</button>` : "";
    const removeBtn = `<button class="trans-dest-remove" onclick="transRemoverDestinatario(${i})" title="Remover">✕</button>`;

    const isActive = d.status === "enviando" || d.status === "verificando";

    return `
      <div class="trans-dest-item${isActive ? " trans-dest-active" : ""}">
        <div class="trans-dest-info">
          <span class="trans-dest-nome">${d.nome || "Sem nome"} <small>· ${d.apartamento || ""}</small></span>
          <span class="trans-dest-tel">${d.telefone || ""}</span>
          ${erroText}
        </div>
        <span class="trans-dest-status ${statusClass}">${statusLabel}</span>
        ${retryBtn}
        ${removeBtn}
      </div>
    `;
  }).join("");
}

// ── Editar mensagem ──
async function transEditarMensagem() {
  if (!_transDetalheId || !db) return;
  const novoTexto = document.getElementById("trans-detalhe-mensagem").value.trim();
  if (!novoTexto) return mostrarToast("A mensagem não pode estar vazia", "err");

  try {
    await db.collection("transmissoes").doc(_transDetalheId).update({
      mensagemTemplate: novoTexto
    });
    _transDetalheData.mensagemTemplate = novoTexto;
    mostrarToast("Mensagem atualizada", "ok");
  } catch (err) {
    mostrarToast("Erro ao salvar: " + err.message, "err");
  }
}

// ── Deletar transmissão ──
async function transDeletar() {
  if (!_transDetalheId || !db) return;

  const confirmado = confirm("Tem certeza que deseja excluir esta transmissão?\nEsta ação não pode ser desfeita.");
  if (!confirmado) return;

  try {
    // Calcula bytes para subtrair do storage (estrutura + fotos)
    const total = _transDetalheData?.totalDestinatarios || 0;
    const midiasSalvas = Array.isArray(_transDetalheData?.midias) ? _transDetalheData.midias : [];
    const bytesFotos = midiasSalvas.reduce((acc, f) => acc + (typeof f === 'string' ? f.length : 0), 0);
    const bytesEstimados = 500 + (total * 200) + bytesFotos;

    await db.collection("transmissoes").doc(_transDetalheId).delete();
    await atualizarStorageUsado(-bytesEstimados);

    fecharModalTransmissao();
    mostrarToast("Transmissão excluída", "ok");
  } catch (err) {
    mostrarToast("Erro ao excluir: " + err.message, "err");
  }
}

// ── Parar transmissão em andamento ──
async function transParar() {
  if (!_transDetalheId) return;

  // Tenta cancelar o job no backend (se ainda estiver rodando)
  if (disparoJobAtual) {
    try {
      await fetch(`${API_BASE}/api/send-batch/${disparoJobAtual}/cancelar`, { method: "POST" });
    } catch (_) {}
  }

  // Marca como pausada no Firestore
  try {
    await db.collection("transmissoes").doc(_transDetalheId).update({ status: "pausada" });
    _transDetalheData.status = "pausada";
    document.getElementById("trans-btn-parar").style.display = "none";
    document.getElementById("trans-btn-continuar").style.display = "inline-flex";
    const statusEl = document.getElementById("trans-detalhe-status");
    statusEl.className = "trans-status trans-status-warn";
    statusEl.textContent = "⏸️ Pausada";
    mostrarToast("Transmissão pausada", "ok");
  } catch (err) {
    mostrarToast("Erro ao parar: " + err.message, "err");
  }
}

// ── Continuar transmissão pausada ──
async function transContinuar() {
  if (!_transDetalheId) return;
  const idParaRetomar = _transDetalheId;

  // Salva a mensagem atual do textarea antes de enviar
  const mensagemAtual = (document.getElementById("trans-detalhe-mensagem")?.value || "").trim();

  // Captura mídias ANTES de fecharModalTransmissao limpar o array
  const midiasParaEnviar = [...transMidias];

  if (db) {
    try {
      const update = {};
      if (mensagemAtual) update.mensagemTemplate = mensagemAtual;
      if (midiasParaEnviar.length > 0) update.midias = midiasParaEnviar;
      if (Object.keys(update).length > 0) {
        await db.collection("transmissoes").doc(idParaRetomar).update(update);
      }
    } catch(_) {}
  }

  await retomarTransmissao(idParaRetomar, midiasParaEnviar);
}


// ── Adicionar destinatários da lista geral de clientes ──
function transAbrirAdicionarClientes() {
  const painel = document.getElementById("trans-adicionar-painel");
  painel.style.display = "block";
  document.getElementById("trans-adicionar-busca").value = "";

  // Verifica quais itens já estão na lista (por nome + telefone + apartamento juntos)
  const jaAdicionados = new Set((_transDetalheData?.destinatarios || []).map(d =>
    `${(d.nome||"").toLowerCase()}|${(d.telefone||"").replace(/\D/g,"")}|${(d.apartamento||"").toLowerCase()}`
  ));

  const lista = document.getElementById("trans-adicionar-lista");
  lista.innerHTML = (todosOsDados || []).map((c, i) => {
    const chave = `${(c.nome||"").toLowerCase()}|${(c.telefone||"").replace(/\D/g,"")}|${(c.apartamento||"").toLowerCase()}`;
    const jaExiste = jaAdicionados.has(chave);
    return `
      <label class="trans-adicionar-item${jaExiste ? " trans-adicionar-disabled" : ""}">
        <input type="checkbox" class="trans-adicionar-check" value="${i}" ${jaExiste ? "disabled checked" : ""} />
        <div class="trans-adicionar-info">
          <span class="trans-adicionar-nome">${c.nome}</span>
          <span class="trans-adicionar-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? " · " + c.condominio : ""}</span>
        </div>
        ${jaExiste ? '<span class="trans-adicionar-tag">já na lista</span>' : ""}
      </label>
    `;
  }).join("");
}

function transFecharAdicionarClientes() {
  document.getElementById("trans-adicionar-painel").style.display = "none";
}

function transFilterAdicionarClientes() {
  const termo = (document.getElementById("trans-adicionar-busca")?.value || "").toLowerCase().trim();
  document.querySelectorAll(".trans-adicionar-item").forEach(item => {
    if (!termo) { item.style.display = ""; return; }
    const nome = (item.querySelector(".trans-adicionar-nome")?.textContent || "").toLowerCase();
    const sub = (item.querySelector(".trans-adicionar-sub")?.textContent || "").toLowerCase();
    item.style.display = (nome.includes(termo) || sub.includes(termo)) ? "" : "none";
  });
}

function transSelAdicionarTodos(sel) {
  document.querySelectorAll(".trans-adicionar-item").forEach(item => {
    if (item.style.display === "none") return; // respeita filtro
    const cb = item.querySelector(".trans-adicionar-check");
    if (cb && !cb.disabled) cb.checked = sel;
  });
}

async function transConfirmarAdicionar() {
  if (!_transDetalheId || !db) return;

  const checks = document.querySelectorAll(".trans-adicionar-check:checked:not(:disabled)");
  if (checks.length === 0) return mostrarToast("Selecione pelo menos um cliente", "err");

  const novos = [];
  checks.forEach(cb => {
    const idx = parseInt(cb.value);
    const c = todosOsDados[idx];
    if (!c) return;
    novos.push({
      telefone: c.telefone,
      nome: c.nome || "",
      apartamento: c.apartamento || "",
      status: "pendente",
      erro: null,
      enviadoEm: null,
    });
  });

  try {
    const docRef = db.collection("transmissoes").doc(_transDetalheId);
    const doc = await docRef.get();
    if (!doc.exists) return;

    const data = doc.data();
    const dest = data.destinatarios || [];
    dest.push(...novos);

    const pendentes = dest.filter(d => d.status === "pendente").length;
    const total = dest.length;

    await docRef.update({
      destinatarios: dest,
      totalDestinatarios: total,
      pendentes,
    });

    // Se a transmissão estava concluída/cancelada e agora tem pendentes, muda pra pausada
    if (pendentes > 0 && (_transDetalheData.status === "concluida" || _transDetalheData.status === "cancelada")) {
      await docRef.update({ status: "pausada" });
      _transDetalheData.status = "pausada";
      const statusEl = document.getElementById("trans-detalhe-status");
      if (statusEl) { statusEl.className = "trans-status trans-status-warn"; statusEl.textContent = "⏸️ Pausada"; }
    }

    await atualizarStorageUsado(novos.length * 200);

    _transDetalheData.destinatarios = dest;
    _transDetalheData.totalDestinatarios = total;
    _transDetalheData.pendentes = pendentes;
    _renderizarDestinatariosModal(dest, true);

    const enviados = _transDetalheData.enviados || 0;
    const erros = _transDetalheData.erros || 0;
    document.getElementById("trans-detalhe-resumo").textContent =
      `${enviados} enviada(s) · ${erros} erro(s) · ${pendentes} pendente(s) — total ${total}`;

    // Atualiza botão continuar
    if (pendentes > 0) {
      document.getElementById("trans-btn-continuar").style.display = "inline-flex";
    }

    transFecharAdicionarClientes();
    mostrarToast(`${novos.length} cliente(s) adicionado(s)`, "ok");
  } catch (err) {
    mostrarToast("Erro ao adicionar: " + err.message, "err");
  }
}

// Mantém a função antiga como atalho (caso alguém chame diretamente)
async function transAdicionarDestinatario() { transAbrirAdicionarClientes(); }

// ── Reenviar para um destinatário específico que deu erro ──
async function transReenviarIndividual(idx) {
  if (!_transDetalheId || !db) return;
  if (waStatus !== "pronto") return mostrarToast("Conecte o WhatsApp primeiro", "err");

  const dest = _transDetalheData?.destinatarios;
  if (!dest || !dest[idx] || dest[idx].status !== "erro") return;

  const d = dest[idx];
  const mensagem = (document.getElementById("trans-detalhe-mensagem")?.value || _transDetalheData.mensagemTemplate || "").trim();
  if (!mensagem) return mostrarToast("Escreva uma mensagem primeiro", "err");

  // Marca como pendente e salva
  dest[idx].status = "pendente";
  dest[idx].erro = null;
  const pendentes = dest.filter(x => x.status === "pendente").length;
  const erros = dest.filter(x => x.status === "erro").length;

  try {
    await db.collection("transmissoes").doc(_transDetalheId).update({
      destinatarios: dest,
      pendentes,
      erros,
      mensagemTemplate: mensagem,
      status: "em_andamento",
    });
  } catch (err) {
    return mostrarToast("Erro ao atualizar: " + err.message, "err");
  }

  _transDetalheData.destinatarios = dest;
  _transDetalheData.pendentes = pendentes;
  _transDetalheData.erros = erros;
  _transDetalheData.status = "em_andamento";

  // Fecha modal e envia só esse
  const idParaRetomar = _transDetalheId;
  fecharModalTransmissao();

  // Monta UI mínima
  document.getElementById("modalTitulo").textContent = `🔄 Reenviando para ${d.nome || d.telefone}`;
  document.getElementById("modalTexto").textContent = "Enviando...";
  removerBannerDisparo();
  const lista = document.getElementById("modalLista");
  lista.innerHTML = "";
  lista.className = "send-progress";
  disparoClientesRef = [d];

  const div = document.createElement("div");
  div.className = "send-item";
  div.id = "send-item-0";
  div.innerHTML = `
    <span class="send-item-name">${d.nome} <small style="opacity:.6">· Apto ${d.apartamento || ""}</small></span>
    <span class="send-item-status send-pending" id="send-status-0">⏳ Enviando...</span>
  `;
  lista.appendChild(div);
  document.getElementById("modalMsg").style.display = "flex";

  window._transmissaoAtual = idParaRetomar;
  window._transmissaoIndicesPendentes = [idx];

  // Dispara envio
  try {
    const res = await fetch(`${API_BASE}/api/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagens: [{ telefone: d.telefone, mensagem, nome: d.nome }], fotos: transMidias.length > 0 ? [...transMidias] : (Array.isArray(_transDetalheData?.midias) ? _transDetalheData.midias : []), transmissaoId: idParaRetomar })
    });
    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const e = await res.json(); errMsg = e.erro || errMsg; } catch(_) {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    disparoJobAtual = data.jobId;
    // Ativa o item com spinner imediatamente
    const firstEl = document.getElementById("send-status-0");
    const firstItem = document.getElementById("send-item-0");
    if (firstEl) firstEl.innerHTML = '<span class="trans-dest-spinner"></span> Iniciando...';
    if (firstItem) firstItem.classList.add("trans-dest-active");
  } catch (err) {
    document.getElementById("modalTexto").innerHTML =
      `<span class="send-error-banner">❌ Falha — ${err.message}</span>`;
    try { await db.collection("transmissoes").doc(idParaRetomar).update({ status: "pausada" }); } catch(_) {}
  }
}

// ── Remover destinatário pendente ──
async function transRemoverDestinatario(idx) {
  if (!_transDetalheId || !db) return;

  const dest = _transDetalheData?.destinatarios;
  if (!dest || !dest[idx]) return;

  const nome = dest[idx].nome || dest[idx].telefone;
  if (!confirm(`Remover ${nome} da lista?`)) return;

  try {
    dest.splice(idx, 1);
    const pendentes = dest.filter(d => d.status === "pendente").length;
    const enviados = dest.filter(d => d.status === "enviado").length;
    const erros = dest.filter(d => d.status === "erro").length;
    const total = dest.length;

    await db.collection("transmissoes").doc(_transDetalheId).update({
      destinatarios: dest,
      totalDestinatarios: total,
      pendentes,
      enviados,
      erros,
    });

    await atualizarStorageUsado(-200);

    _transDetalheData.destinatarios = dest;
    _transDetalheData.totalDestinatarios = total;
    _transDetalheData.pendentes = pendentes;
    _transDetalheData.enviados = enviados;
    _transDetalheData.erros = erros;
    _renderizarDestinatariosModal(dest, true);

    document.getElementById("trans-detalhe-resumo").textContent =
      `${enviados} enviada(s) · ${erros} erro(s) · ${pendentes} pendente(s) — total ${total}`;

    mostrarToast(`${nome} removido(a)`, "ok");
  } catch (err) {
    mostrarToast("Erro ao remover: " + err.message, "err");
  }
}

// ── Fixar/desfixar transmissão (impede auto-limpeza de 7 dias) ──
async function transToggleFixar(fixada) {
  if (!_transDetalheId || !db) return;
  try {
    await db.collection("transmissoes").doc(_transDetalheId).update({ fixada: !!fixada });
    _transDetalheData.fixada = !!fixada;
    mostrarToast(fixada ? "📌 Transmissão fixada (não será apagada)" : "Transmissão desfixada", fixada ? "ok" : "info");
  } catch (err) {
    mostrarToast("Erro ao fixar: " + err.message, "err");
    document.getElementById("trans-fixar-toggle").checked = !fixada; // reverte visual
  }
}

// ── Editar título da transmissão (modo inline) ──
function transIniciarEdicaoTitulo() {
  const display = document.getElementById("trans-titulo-display");
  const input = document.getElementById("trans-detalhe-titulo-input");
  display.parentElement.style.display = "none";
  input.style.display = "block";
  input.focus();
  input.select();
}

async function transSalvarTitulo() {
  const display = document.getElementById("trans-titulo-display");
  const input = document.getElementById("trans-detalhe-titulo-input");
  const novoTitulo = (input.value || "").trim();

  // Volta ao modo display
  input.style.display = "none";
  display.parentElement.style.display = "flex";

  if (!novoTitulo || !_transDetalheId || !db) return;
  if (novoTitulo === _transDetalheData?.titulo) return; // não mudou

  display.textContent = novoTitulo;

  try {
    await db.collection("transmissoes").doc(_transDetalheId).update({ titulo: novoTitulo });
    _transDetalheData.titulo = novoTitulo;
    mostrarToast("Título atualizado", "ok");
  } catch (err) {
    mostrarToast("Erro ao salvar título: " + err.message, "err");
  }
}

// Mantém compatibilidade com onchange (caso algum fluxo antigo chame)
async function transEditarTitulo() { await transSalvarTitulo(); }

// ── Reenviar para toda a lista (reseta todos como pendente e dispara) ──
async function transReenviar() {
  if (!_transDetalheId || !db) return;
  if (waStatus !== "pronto") return mostrarToast("Conecte o WhatsApp primeiro", "err");

  const t = _transDetalheData;
  const dest = t.destinatarios || [];
  if (dest.length === 0) return mostrarToast("Nenhum destinatário na lista", "err");

  // Pega o texto atual do textarea (pode ter sido editado)
  const mensagem = (document.getElementById("trans-detalhe-mensagem")?.value || "").trim();
  if (!mensagem) return mostrarToast("Escreva uma mensagem antes de reenviar", "err");

  const confirmado = confirm(
    `Reenviar para ${dest.length} destinatário(s) com a mensagem atual?\n\n` +
    `Todos serão marcados como pendentes e o envio começará do início.`
  );
  if (!confirmado) return;

  // Captura mídias ANTES de fecharModalTransmissao limpar o array
  const midiasParaEnviar = [...transMidias];

  try {
    // Reseta todos para pendente
    const novoDest = dest.map(d => ({
      ...d,
      status: "pendente",
      erro: null,
      enviadoEm: null,
    }));

    await db.collection("transmissoes").doc(_transDetalheId).update({
      destinatarios: novoDest,
      mensagemTemplate: mensagem,
      midias: midiasParaEnviar,
      status: "em_andamento",
      enviados: 0,
      erros: 0,
      pendentes: novoDest.length,
    });

    _transDetalheData.destinatarios = novoDest;
    _transDetalheData.mensagemTemplate = mensagem;
    _transDetalheData.midias = midiasParaEnviar;
    _transDetalheData.status = "em_andamento";
    _transDetalheData.enviados = 0;
    _transDetalheData.erros = 0;
    _transDetalheData.pendentes = novoDest.length;

    const idParaRetomar = _transDetalheId;

    // Usa a função retomarTransmissao que já sabe pegar os pendentes e enviar
    await retomarTransmissao(idParaRetomar, midiasParaEnviar);
  } catch (err) {
    mostrarToast("Erro ao reenviar: " + err.message, "err");
  }
}


// ==============================================
//  NAVEGAÇÃO ENTRE PÁGINAS
// ==============================================
function irPara(pagina) {
  ['dashboard', 'propriedades', 'transmissoes', 'configuracoes'].forEach(p => {
    const el   = document.getElementById('page-' + p);
    const nav  = document.getElementById('nav-' + p);
    const bnav = document.getElementById('bnav-' + p);
    if (el)   el.style.display = (p === pagina) ? 'flex' : 'none';
    if (nav)  nav.classList.toggle('active', p === pagina);
    if (bnav) bnav.classList.toggle('bnav-active', p === pagina);
  });
  if (pagina === 'propriedades') renderizarPropriedades();
  if (pagina === 'transmissoes') carregarTransmissoes();
  if (pagina === 'configuracoes') carregarTelaConfiguracoes();
}

// ==============================================
//  PROPRIEDADES
// ==============================================

let propriedades       = [];
let propIndexRemover   = -1;
let propIndexDisparo   = -1;
let mensagemTipoAtivo  = null;
let disparoMidias      = []; // data URLs de imagens/vídeos a enviar junto com a mensagem

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
      // Nota: recalcularStorageTotal() foi removido daqui propositalmente.
      // O storageUsed é mantido de forma incremental (upload soma, delete subtrai).
      // Chamar recalcularStorageTotal() aqui sobrescrevia os bytes recém-adicionados.
    }, error => {
      console.error("Erro ao carregar propriedades:", error);
    });
}

let filtroPropTipo  = 'Todos';
let filtroPropBusca = '';

function setFiltroTipoProp(tipo) {
  filtroPropTipo = tipo;
  document.querySelectorAll('.pchip').forEach(c =>
    c.classList.toggle('active', c.textContent === tipo));
  filtrarPropriedades();
}

function filtrarPropriedades() {
  filtroPropBusca = (document.getElementById('propSearchInput').value || '').toLowerCase().trim();
  renderizarPropriedades();
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

  // Monta chips de tipo
  const tipos = ['Todos', ...new Set(propriedades.map(p => p.tipo).filter(Boolean))];
  document.getElementById('propsChipsTipo').innerHTML = tipos.map(t =>
    `<button class="pchip${t === filtroPropTipo ? ' active' : ''}" onclick="setFiltroTipoProp('${t}')">${t}</button>`
  ).join('');

  const tipoClasses = {
    "Casa":      "prop-tipo-casa",
    "Cobertura": "prop-tipo-cobertura",
    "Comercial": "prop-tipo-comercial",
    "Terreno":   "prop-tipo-terreno",
  };

  // Aplica filtros
  let lista = propriedades;
  if (filtroPropTipo !== 'Todos') lista = lista.filter(p => p.tipo === filtroPropTipo);
  if (filtroPropBusca) lista = lista.filter(p =>
    [p.titulo, p.bairro, p.cidade, p.endereco, p.descricao, p.tipo]
      .some(v => v && v.toLowerCase().includes(filtroPropBusca))
  );

  grid.innerHTML = lista.map((p, i) => {
    // Índice original para editar/excluir/disparar
    const origIdx = propriedades.indexOf(p);
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
      const f0 = fotos[0];
      imgAreaHtml = `
        <div class="prop-img">
          ${ehVideo(f0)
            ? `<video src="${urlFoto(f0)}" class="prop-img-video" muted playsinline preload="metadata"></video><div class="prop-img-play-icon">▶</div>`
            : `<img src="${urlFoto(f0)}" alt="Foto" />`}
        </div>`;
    } else {
      const slides = fotos.map(f => {
        const src = urlFoto(f);
        const media = ehVideo(f)
          ? `<video src="${src}" class="prop-img-video" muted playsinline preload="metadata"></video><div class="prop-img-play-icon">▶</div>`
          : `<img src="${src}" alt="Foto" />`;
        return `<div class="prop-carousel-slide">${media}</div>`;
      }).join('');
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
    if (p.area)      detalhes.push(`<span class="prop-detail-item">📐 ${p.area} m²</span>`);

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
            <span class="prop-preco">${formatarPreco(p.preco)}</span>
            <div class="prop-actions">
              <button class="btn-icon btn-icon-edit" onclick="abrirFormProp(${origIdx})" title="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-icon-del" onclick="confirmarRemoverProp(${origIdx})" title="Remover">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
              <button class="btn btn-primary btn-sm-icon" onclick="abrirModalDisparo(${origIdx})" style="font-size:.77rem;padding:6px 11px;gap:5px">
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
    document.getElementById("p-preco").value     = precoParaInput(p.preco);
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
    preco:     limparPreco(document.getElementById("p-preco").value),
    area:      limparDecimal(document.getElementById("p-area").value),
    quartos:   document.getElementById("p-quartos").value || "0",
    banheiros: document.getElementById("p-banheiros").value || "0",
    vagas:     document.getElementById("p-vagas").value || "0",
    descricao: document.getElementById("p-desc").value.trim(),
  };

  if (idx === -1 && storageExcedido()) {
    mostrarToast("❌ Armazenamento cheio. Entre em contato com o administrador.", "err");
    return;
  }

  const btn = event.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }

  try {
    // Upload das fotos novas (data URLs) → Firebase Storage; fotos existentes (objetos) passam direto
    // Nota: fotos removidas no form já foram deletadas do Storage e contabilizadas por removerFotoForm()
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

const ESTIMATIVA_CLIENTE = 2048; // 2 KB por cliente

function urlFoto(f) {
  return typeof f === 'object' && f !== null ? f.url : f;
}

// Detecta se uma mídia (data URL, URL HTTPS ou objeto {url,type}) é vídeo
function ehVideo(src) {
  if (typeof src === 'object' && src !== null) {
    if (src.type && src.type.startsWith('video/')) return true;
    const u = src.url || '';
    return u.startsWith('data:video') || /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i.test(u);
  }
  if (typeof src === 'string') {
    if (src.startsWith('data:video')) return true;
    return /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i.test(src);
  }
  return false;
}

function ehPdf(src) {
  if (typeof src === 'object' && src !== null) {
    if (src.type && src.type.includes('pdf')) return true;
    const u = src.url || '';
    return u.startsWith('data:application/pdf') || /\.pdf(\?|$)/i.test(u);
  }
  if (typeof src === 'string') {
    if (src.startsWith('data:application/pdf')) return true;
    return /\.pdf(\?|$)/i.test(src);
  }
  return false;
}

function ehImagem(src) {
  if (typeof src === 'object' && src !== null) {
    if (src.type && src.type.startsWith('image/')) return true;
    const u = src.url || '';
    return u.startsWith('data:image') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(u);
  }
  if (typeof src === 'string') {
    if (src.startsWith('data:image')) return true;
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(src);
  }
  return false;
}

// ---- Storage Helpers ----
function calcularTamanhoBase64(dataUrl) {
  const base64 = dataUrl.split(",")[1] || dataUrl;
  return Math.round(base64.length * 0.75);
}

async function atualizarStorageUsado(deltaBytes) {
  if (!currentUser || !userData) return;
  const ref = db.collection("users").doc(currentUser.uid);
  try {
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      const atual = (doc.data() && doc.data().storageUsed) || 0;
      t.update(ref, { storageUsed: Math.max(0, atual + deltaBytes) });
    });
    userData.storageUsed = Math.max(0, (userData.storageUsed || 0) + deltaBytes);
    atualizarStorageBar();
  } catch (err) {
    console.error("Erro ao atualizar storageUsed:", err);
  }
}

async function recalcularStorageTotal() {
  if (!currentUser) return;
  let total = (todosOsDados || []).length * ESTIMATIVA_CLIENTE;
  for (const p of propriedades) {
    const fotos = Array.isArray(p.fotos) ? p.fotos : (p.foto ? [p.foto] : []);
    for (const f of fotos) {
      if (typeof f === 'object' && f !== null && f.size) total += f.size;
    }
  }
  try {
    await db.collection("users").doc(currentUser.uid).update({ storageUsed: total });
    if (userData) userData.storageUsed = total;
    atualizarStorageBar();
  } catch (err) {
    console.error("Erro ao recalcular storage:", err);
  }
}

// ---- Upload de fotos/vídeos para Firebase Storage ----
async function uploadFotos(fotosArray) {
  const urls = [];
  let totalBytes = 0;
  for (const foto of fotosArray) {
    if (typeof foto === 'object' && foto !== null && foto.url) {
      urls.push(foto);
      continue;
    }
    if (typeof foto === 'string' && foto.startsWith("https://")) {
      urls.push(foto);
      continue;
    }
    try {
      // Detecta mime type e extensão a partir do data URL
      const mimeMatch = foto.match(/^data:([^;]+);/);
      const mimetype  = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const ext       = mimetype.split('/')[1]?.replace('jpeg','jpg').replace('quicktime','mov') || 'bin';
      const prefix    = mimetype.startsWith('video/') ? 'video' : 'foto';
      const fileName  = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const ref       = storage.ref(`fotos/${currentUser.uid}/${fileName}`);
      const snapshot  = await ref.putString(foto, "data_url");
      const url       = await snapshot.ref.getDownloadURL();
      const tamanho   = calcularTamanhoBase64(foto);
      urls.push({ url, size: tamanho, type: mimetype });
      totalBytes += tamanho;
    } catch (err) {
      console.error("Erro ao fazer upload de mídia:", err);
    }
  }
  if (totalBytes > 0) await atualizarStorageUsado(totalBytes);
  return urls;
}

// ---- Gerenciamento de múltiplas fotos no formulário ----
let fotosTemp = []; // base64[] das fotos do formulário aberto

function handleFotos(event) {
  const files = [...event.target.files];
  const limite = 10;
  const restam = limite - fotosTemp.length;
  if (restam <= 0) { mostrarToast("⚠️ Limite de 10 mídias atingido.", "err"); return; }

  const filesToProcess = files.slice(0, restam);
  if (files.length > restam) mostrarToast(`⚠️ Apenas ${restam} mídia(s) adicionada(s) (limite de ${limite}).`, "err");

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

  const thumbs = fotosTemp.map((src, i) => {
    const srcUrl = urlFoto(src);
    const video  = ehVideo(src);
    const isPdf  = ehPdf(src);
    const isDoc  = !video && !isPdf && !ehImagem(src);
    let media;
    if (isPdf) {
      media = `<div class="foto-thumb-doc foto-thumb-pdf">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/><text x="7" y="17" font-size="5" fill="#fff" font-weight="bold">PDF</text></svg>
      </div>`;
    } else if (isDoc) {
      media = `<div class="foto-thumb-doc">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/></svg>
      </div>`;
    } else if (video) {
      media = `<video src="${srcUrl}" class="foto-thumb-video" muted playsinline preload="metadata"></video>
         <div class="foto-thumb-play-icon">▶</div>`;
    } else {
      media = `<img src="${srcUrl}" alt="Foto ${i+1}" />`;
    }
    return `
      <div class="foto-thumb">
        ${media}
        ${i === 0 ? '<span class="foto-thumb-badge">Principal</span>' : ''}
        <button type="button" class="foto-thumb-remove" onclick="removerFotoForm(${i})" title="Remover">✕</button>
      </div>`;
  }).join('');

  const addBtn = fotosTemp.length < 10 ? `
    <div class="foto-add-btn" onclick="document.getElementById('p-fotos').click()" title="Adicionar arquivo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span>Anexar</span>
    </div>` : '';

  grid.innerHTML = thumbs + addBtn;
}

async function removerFotoForm(idx) {
  const foto = fotosTemp[idx];
  fotosTemp.splice(idx, 1);
  renderizarFotosForm();

  // Se a foto já estava no Firebase Storage, deleta o arquivo imediatamente
  if (foto && typeof foto === 'object' && foto.url &&
      typeof foto.url === 'string' && foto.url.startsWith('https://firebasestorage')) {
    try {
      const fileRef = storage.refFromURL(foto.url);
      await fileRef.delete();
      // Subtrai bytes do contador ao remover durante edição
      if (foto.size > 0) await atualizarStorageUsado(-foto.size);
    } catch (err) {
      console.warn('Falha ao deletar foto do Storage ao remover do form:', err.code, foto.url);
    }
  }
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
    const pDel = propriedades[propIndexRemover];
    const docId = pDel._firestoreId || pDel.id;
    let bytesLiberados = 0;
    const fotosDel = Array.isArray(pDel.fotos) ? pDel.fotos : (pDel.foto ? [pDel.foto] : []);

    try {
      // Remove cada arquivo do Firebase Storage antes de apagar o documento
      for (const f of fotosDel) {
        const url = typeof f === 'object' && f !== null ? f.url : f;
        const size = typeof f === 'object' && f !== null && f.size ? f.size : 0;

        if (url && typeof url === 'string' && url.startsWith('https://firebasestorage')) {
          try {
            // Extrai a referência a partir da URL pública do Firebase Storage
            const fileRef = storage.refFromURL(url);
            await fileRef.delete();
            bytesLiberados += size;
          } catch (storageErr) {
            // Arquivo pode já ter sido deletado ou URL inválida — ignora
            console.warn('Falha ao deletar arquivo do Storage:', storageErr.code, url);
            bytesLiberados += size; // subtrai do contador mesmo assim (arquivo não existe mais)
          }
        } else if (size > 0) {
          // URL não é do Firebase Storage (ex: formato antigo) — só subtrai o contador
          bytesLiberados += size;
        }
      }

      await db.collection("propriedades").doc(docId).delete();
      if (bytesLiberados > 0) await atualizarStorageUsado(-bytesLiberados);
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

  const info = [prop.tipo, prop.area ? `${prop.area} m²` : ''].filter(Boolean).join(' · ');
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
  if (prop.preco) linhas.push(`💰 *${formatarPreco(prop.preco)}*`);
  linhas.push('');
  linhas.push('📞 Entre em contato com *LF Imóveis* para mais informações!');

  // Link de fotos — append apenas se a propriedade já tem ID no Firestore
  const propId = prop._firestoreId || prop.id;
  const temFotos = (Array.isArray(prop.fotos) && prop.fotos.length > 0) || !!prop.foto;
  if (propId && temFotos) {
    linhas.push('');
    linhas.push(`📸 *Ver fotos:* https://tech-corretor.web.app/imoveis?id=${propId}`);
  }

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
  // Limpa busca anterior ao abrir o modal
  const buscaInput = document.getElementById("disparo-busca");
  if (buscaInput) buscaInput.value = "";
  document.getElementById("modalDisparo").style.display = "flex";
}

function fecharModalDisparo() {
  document.getElementById("modalDisparo").style.display = "none";
  propIndexDisparo = -1;
  mensagemTipoAtivo = null;
  disparoMidias = [];
  renderizarPreviewMidias();
}

// ---- Upload de mídias (foto/vídeo) no disparo ----
function adicionarMidiaDisparo(input) {
  const files = Array.from(input.files || []);
  files.forEach(file => {
    if (disparoMidias.length >= 5) {
      alert("Máximo de 5 arquivos por disparo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      disparoMidias.push(e.target.result);
      renderizarPreviewMidias();
    };
    reader.readAsDataURL(file);
  });
  input.value = ""; // permite selecionar o mesmo arquivo de novo
}

function removerMidiaDisparo(idx) {
  disparoMidias.splice(idx, 1);
  renderizarPreviewMidias();
}

function renderizarPreviewMidias() {
  const lista = document.getElementById("disparo-midia-list");
  if (!lista) return;
  lista.innerHTML = "";
  disparoMidias.forEach((dataUrl, idx) => {
    const isVideo = dataUrl.startsWith("data:video");
    const isPdf = dataUrl.startsWith("data:application/pdf");
    const isImage = dataUrl.startsWith("data:image");
    const item = document.createElement("div");
    item.className = "disparo-midia-item";
    if (isPdf) {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-pdf">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/><text x="7" y="17" font-size="5" fill="#fff" font-weight="bold">PDF</text></svg>
        </div>
        <button class="disparo-midia-remove" onclick="removerMidiaDisparo(${idx})" title="Remover">✕</button>
      `;
    } else if (isVideo) {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-video">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <button class="disparo-midia-remove" onclick="removerMidiaDisparo(${idx})" title="Remover">✕</button>
      `;
    } else if (isImage) {
      item.innerHTML = `
        <img class="disparo-midia-thumb" src="${dataUrl}" alt="mídia ${idx + 1}">
        <button class="disparo-midia-remove" onclick="removerMidiaDisparo(${idx})" title="Remover">✕</button>
      `;
    } else {
      item.innerHTML = `
        <div class="disparo-midia-thumb disparo-midia-doc">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8" fill="none" stroke="#fff" stroke-width="1.5"/></svg>
        </div>
        <button class="disparo-midia-remove" onclick="removerMidiaDisparo(${idx})" title="Remover">✕</button>
      `;
    }
    lista.appendChild(item);
  });
}

function selecionarTodosClientes(sel) {
  // Seleciona/deseleciona apenas os itens VISÍVEIS (não filtrados)
  document.querySelectorAll(".disparo-item").forEach(item => {
    if (item.style.display !== "none") {
      const cb = item.querySelector(".disparo-check");
      if (cb) cb.checked = sel;
    }
  });
  atualizarContadorDisparo();
}

function filtrarDestinatarios() {
  const termo = (document.getElementById("disparo-busca")?.value || "").toLowerCase().trim();
  const itens = document.querySelectorAll(".disparo-item");

  itens.forEach(item => {
    if (!termo) {
      item.style.display = "";
      return;
    }
    const nome = (item.querySelector(".disparo-item-nome")?.textContent || "").toLowerCase();
    const sub = (item.querySelector(".disparo-item-sub")?.textContent || "").toLowerCase();
    const match = nome.includes(termo) || sub.includes(termo);
    item.style.display = match ? "" : "none";
  });
}

function atualizarContadorDisparo() {
  const total = document.querySelectorAll(".disparo-check:checked").length;
  const el = document.getElementById("disparo-counter");
  if (el) el.innerHTML = `<strong>${total}</strong> cliente${total !== 1 ? 's' : ''} selecionado${total !== 1 ? 's' : ''}`;
}

// ---- Montar colagem de fotos para envio via WhatsApp (canvas → base64 JPEG) ----
// Carrega imagens via fetch→blob→objectURL para evitar CORS taint no canvas.
// Grid: 1 foto→1×1  2→2×1  3-4→2×2  5-9→3×N
async function montarColagem(fotos) {
  const urls = fotos
    .map(f => (typeof f === 'object' && f !== null) ? (f.url || '') : (typeof f === 'string' ? f : ''))
    .filter(u => u.length > 0);

  if (urls.length === 0) return [];

  // Para HTTPS (Firebase Storage), faz fetch → blob → objectURL para evitar
  // que o canvas fique "tainted" e impeça o toDataURL().
  const blobUrls = [];
  const loadImg = async src => {
    try {
      if (src.startsWith('http')) {
        const res = await fetch(src);
        if (!res.ok) return null;
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobUrls.push(blobUrl); // registra para revogar depois
        src = blobUrl;
      }
      return await new Promise(resolve => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    } catch(e) {
      return null;
    }
  };

  const MAX  = 9;
  const imgs = await Promise.all(urls.slice(0, MAX).map(loadImg));
  const validas = imgs.filter(Boolean);

  if (validas.length === 0) {
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    return [];
  }

  let resultado = [];

  try {
    if (validas.length === 1) {
      const img = validas[0];
      const cv  = document.createElement('canvas');
      const MAX_SIDE = 1200;
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      cv.width  = Math.round((img.naturalWidth  || 800) * scale);
      cv.height = Math.round((img.naturalHeight || 600) * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resultado = [cv.toDataURL('image/jpeg', 0.88)];
    } else {
      const n    = validas.length;
      const cols = n === 2 ? 2 : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const CELL = 400;
      const GAP  = 4;
      const cv   = document.createElement('canvas');
      cv.width   = cols * CELL + (cols - 1) * GAP;
      cv.height  = rows * CELL + (rows - 1) * GAP;

      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, cv.width, cv.height);

      validas.forEach((img, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x   = col * (CELL + GAP);
        const y   = row * (CELL + GAP);
        const iw  = img.naturalWidth  || 800;
        const ih  = img.naturalHeight || 600;
        const sc  = Math.max(CELL / iw, CELL / ih);
        ctx.drawImage(img,
          (iw - CELL / sc) / 2, (ih - CELL / sc) / 2, CELL / sc, CELL / sc,
          x, y, CELL, CELL
        );
        if (i === MAX - 1 && urls.length > MAX) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.round(CELL * 0.3)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`+${urls.length - MAX}`, x + CELL / 2, y + CELL / 2);
        }
      });
      resultado = [cv.toDataURL('image/jpeg', 0.85)];
    }
  } catch(e) {
    console.warn('[colagem] canvas falhou, enviando URLs diretas:', e.message);
    // Fallback: devolve as URLs originais para o backend baixar diretamente
    resultado = urls.slice(0, MAX);
  } finally {
    blobUrls.forEach(u => URL.revokeObjectURL(u));
  }

  return resultado;
}

async function dispararPropriedade() {
  const selecionados = [...document.querySelectorAll(".disparo-check:checked")]
    .map(cb => todosOsDados[parseInt(cb.value)])
    .filter(Boolean);
  const mensagem = document.getElementById("disparo-mensagem").value;

  const propIdx = propIndexDisparo;
  const msgTipo = mensagemTipoAtivo;
  const fotos = [...disparoMidias]; // captura ANTES de fecharModalDisparo limpar o array

  fecharModalDisparo();

  let titulo;

  if (propIdx >= 0) {
    const prop = propriedades[propIdx];
    titulo = `📤 Disparo: ${prop.titulo}`;
    // Fotos são enviadas via link na mensagem — gerarMensagemProp já incluiu a URL
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
    // Mostra status atual para o usuário entender o que está acontecendo
    const statusMsg = {
      "desconectado": "WhatsApp desconectado. Clique em 'Conectar' na barra lateral.",
      "conectando":   "WhatsApp ainda conectando, aguarde e tente novamente em alguns segundos.",
      "qr":           "Escaneie o QR Code antes de enviar.",
      "autenticado":  "WhatsApp autenticando, aguarde alguns segundos e tente novamente.",
      "erro":         "Erro na conexão WhatsApp. Clique em 'Reconectar' na barra lateral.",
    };
    const msg = statusMsg[waStatus] || "WhatsApp não está pronto. Conecte-o primeiro.";

    const links = selecionados.map(c => {
      const tel = c.telefone.replace(/\D/g, "");
      const msg = fnMensagem(c);
      return {
        label: `📲 ${c.nome} — Apto ${c.apartamento}`,
        url:   `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`
      };
    });
    abrirModal(titulo,
      `⚠️ ${msg}\n\nOu envie manualmente clicando nos links abaixo:`,
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

// ── Máscaras de input ────────────────────────────────────────────
function limparPreco(v) {
  return v.replace(/\./g, "").replace(",", ".");
}
function limparDecimal(v) {
  return v.replace(",", ".");
}

function mascaraPreco(el) {
  let v = el.value.replace(/\D/g, "");
  if (!v) { el.value = ""; return; }
  v = (parseInt(v) / 100).toFixed(2);
  v = v.replace(".", ",");
  v = v.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
  el.value = v;
}

function mascaraDecimal(el) {
  el.value = el.value.replace(/[^0-9,]/g, "");
}

function mascaraInteiro(el) {
  el.value = el.value.replace(/\D/g, "");
}

function formatarPreco(v) {
  if (!v) return '—';
  const num = parseFloat(v);
  if (isNaN(num)) return v;
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function precoParaInput(v) {
  if (!v) return '';
  const num = parseFloat(v);
  if (isNaN(num)) return v;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
