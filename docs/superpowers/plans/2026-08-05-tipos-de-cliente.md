# Tipos de Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a três tipos de cliente (Proprietário, Inquilino, Outro) com formulário dinâmico, abas separadas na tabela e filtros por tipo.

**Architecture:** Campo `tipo` adicionado à coleção `clientes` no Firestore. O formulário detecta o tipo selecionado e mostra/esconde campos via JS. A tabela é dividida em três abas (Proprietários / Inquilinos / Outros), cada uma com colunas e chips próprios. Registros sem `tipo` tratados como `"proprietario"` via fallback.

**Tech Stack:** HTML, Vanilla JS, Firebase Firestore, CSS inline no `style.css`

## Global Constraints

- Coleção Firestore: `clientes` (sem mudança)
- Fallback: `r.tipo || "proprietario"` em todo acesso ao campo tipo
- Sem migração de dados — registros existentes continuam funcionando
- Não alterar lógica de disparo/transmissões (apenas subtítulo do item)
- Arquivos: `src/app.html` e `src/app.js` (não criar novos arquivos)

---

### Task 1: HTML — Formulário dinâmico + Abas na tabela + CSS

**Files:**
- Modify: `src/app.html:458-511` (modal do formulário de cliente)
- Modify: `src/app.html:200-252` (toolbar + tabela do dashboard)
- Modify: `src/style.css` (estilos de `.tipo-selector`, `.tipo-btn`, `.abas-clientes`, `.aba`)

**Interfaces:**
- Produces:
  - `#f-tipo` — input hidden com valor `"proprietario"` | `"inquilino"` | `"outro"`
  - `#tipo-btn-proprietario`, `#tipo-btn-inquilino`, `#tipo-btn-outro` — botões do seletor
  - `#grupo-apartamento-condominio` — div que envolve f-apartamento + f-condominio
  - `#grupo-contrato` — div que envolve f-inicio + f-termino
  - `#aba-proprietario`, `#aba-inquilino`, `#aba-outro` — botões de aba
  - `#count-proprietario`, `#count-inquilino`, `#count-outro` — contadores por aba
  - `#tableLabel` — span com nome da aba ativa na tabela
  - `#chip-vencidos` — chip que será ocultado para inquilino/outro (já existe, sem mudança de id)

- [ ] **Step 1: Substituir o modal `#modalCliente` no `app.html`**

Localizar o bloco entre as linhas `<!-- ===== MODAL FORM CLIENTE ===== -->` e `<!-- ===== MODAL CONFIRMAR EXCLUSÃO ===== -->` e substituir pelo seguinte:

```html
<!-- ===== MODAL FORM CLIENTE ===== -->
<div id="modalCliente" class="modal-overlay" style="display:none;">
  <div class="modal-box modal-form">
    <div class="modal-header">
      <h2 id="formTitulo">Novo cliente</h2>
      <button class="modal-close" onclick="fecharFormCliente()">✕</button>
    </div>

    <form id="formCliente" class="client-form" onsubmit="salvarCliente(event)">
      <input type="hidden" id="clienteIndex" value="-1" />
      <input type="hidden" id="f-tipo" value="proprietario" />

      <!-- Seletor de tipo -->
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label>Tipo de cliente <span class="req">*</span></label>
          <div class="tipo-selector">
            <button type="button" class="tipo-btn tipo-btn-active" id="tipo-btn-proprietario" onclick="selecionarTipo('proprietario')">Sócio/Proprietário</button>
            <button type="button" class="tipo-btn" id="tipo-btn-inquilino" onclick="selecionarTipo('inquilino')">Inquilino</button>
            <button type="button" class="tipo-btn" id="tipo-btn-outro" onclick="selecionarTipo('outro')">Outro</button>
          </div>
        </div>
      </div>

      <!-- Nome + Telefone (sempre visíveis) -->
      <div class="form-row">
        <div class="form-group form-col-2">
          <label for="f-nome">Nome completo <span class="req">*</span></label>
          <input type="text" id="f-nome" placeholder="Ex: João da Silva" required />
        </div>
        <div class="form-group">
          <label for="f-telefone">Telefone <span class="req">*</span></label>
          <input type="text" id="f-telefone" placeholder="(81) 99999-9999" maxlength="15" required />
        </div>
      </div>

      <!-- Nascimento (sempre visível) -->
      <div class="form-row">
        <div class="form-group">
          <label for="f-nascimento">Data de nascimento <span class="req">*</span></label>
          <input type="text" id="f-nascimento" placeholder="DD/MM/AAAA" maxlength="10" required />
        </div>
      </div>

      <!-- Apartamento + Condomínio (proprietário e inquilino) -->
      <div id="grupo-apartamento-condominio" class="form-row">
        <div class="form-group">
          <label for="f-apartamento">Nº Apartamento <span class="req">*</span></label>
          <input type="text" id="f-apartamento" placeholder="Ex: 1401" />
        </div>
        <div class="form-group">
          <label for="f-condominio">Condomínio <span class="req">*</span></label>
          <input type="text" id="f-condominio" placeholder="Ex: Praça dos Jacarandas" />
        </div>
      </div>

      <!-- Datas de contrato (somente proprietário) -->
      <div id="grupo-contrato" class="form-row">
        <div class="form-group">
          <label for="f-inicio">Início do contrato <span class="req">*</span></label>
          <input type="text" id="f-inicio" placeholder="DD/MM/AAAA" maxlength="10" />
        </div>
        <div class="form-group">
          <label for="f-termino">Término do contrato <span class="req">*</span></label>
          <input type="text" id="f-termino" placeholder="DD/MM/AAAA" maxlength="10" />
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="fecharFormCliente()">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="btnSalvar">Salvar cliente</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2: Substituir a seção toolbar + tabela no `app.html`**

Localizar o bloco entre `<!-- Toolbar / Filtros -->` e `</section>` (final da tabela, antes de `</div><!-- /page-dashboard -->`) e substituir por:

```html
<!-- Abas de tipo de cliente -->
<div class="abas-clientes">
  <button class="aba aba-active" id="aba-proprietario" onclick="setAba('proprietario')">
    Proprietários <span class="aba-count" id="count-proprietario">0</span>
  </button>
  <button class="aba" id="aba-inquilino" onclick="setAba('inquilino')">
    Inquilinos <span class="aba-count" id="count-inquilino">0</span>
  </button>
  <button class="aba" id="aba-outro" onclick="setAba('outro')">
    Outros <span class="aba-count" id="count-outro">0</span>
  </button>
</div>

<!-- Toolbar / Filtros -->
<section class="toolbar">
  <div class="search-box">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" id="campoPesquisa" placeholder="Pesquisar por nome, apartamento, condomínio..." oninput="pesquisar()" />
    <button class="search-clear" id="btnLimpar" onclick="limparPesquisa()" style="display:none;">✕</button>
  </div>

  <div class="filter-chips">
    <button class="chip chip-active" id="chip-todos"           onclick="setChip('todos')">Todos</button>
    <button class="chip chip-red"    id="chip-vencidos"        onclick="setChip('vencidos')">🔴 Vencidos</button>
    <button class="chip chip-purple" id="chip-aniversariantes" onclick="setChip('aniversariantes')">🎂 Aniversários</button>
  </div>
</section>

<!-- Table -->
<section class="table-section">
  <div class="table-card">
    <div class="table-header">
      <span class="table-title"><span id="tableLabel">Proprietários</span> <span class="table-count" id="tableCount">0</span></span>
      <button class="btn btn-primary btn-sm-icon" onclick="abrirFormCliente()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo cliente
      </button>
    </div>
    <div class="table-wrapper">
      <table id="tabelaImoveis">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>Apartamento</th>
            <th>Nascimento</th>
            <th>Início contrato</th>
            <th>Término contrato</th>
            <th>Condomínio</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="corpoTabela"></tbody>
      </table>
      <div id="semResultados" class="sem-resultados" style="display:none;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Nenhum resultado encontrado</p>
      </div>
    </div>
    <div id="paginacao" class="paginacao"></div>
  </div>
</section>
```

- [ ] **Step 3: Adicionar estilos em `style.css`**

Localizar o final do arquivo `style.css` e acrescentar:

```css
/* ---- Seletor de tipo de cliente no formulário ---- */
.tipo-selector {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.tipo-btn {
  flex: 1;
  padding: 8px 12px;
  font-size: .83rem;
  font-weight: 500;
  background: var(--bg-card);
  border: none;
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: background .15s, color .15s;
}
.tipo-btn:last-child { border-right: none; }
.tipo-btn:hover { background: var(--bg-hover, #f1f5f9); color: var(--text); }
.tipo-btn-active { background: var(--primary); color: #fff !important; }

/* ---- Abas de tipo de cliente ---- */
.abas-clientes {
  display: flex;
  gap: 4px;
  padding: 0 0 0 0;
  margin: 0 0 -1px 0;
  border-bottom: 2px solid var(--border);
}
.aba {
  padding: 10px 20px;
  font-size: .875rem;
  font-weight: 500;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  transition: color .15s, border-color .15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.aba:hover { color: var(--text); background: var(--bg-hover, #f1f5f9); }
.aba-active { color: var(--primary); border-bottom-color: var(--primary); }
.aba-count {
  background: var(--bg-hover, #f1f5f9);
  color: var(--text-muted);
  font-size: .72rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}
.aba-active .aba-count { background: var(--primary-light, #ede9fe); color: var(--primary); }
```

- [ ] **Step 4: Verificar visualmente no browser**

Abrir `http://localhost:3000` (ou rodar `npm start`), ir para Dashboard e confirmar:
- As 3 abas aparecem acima da toolbar
- O formulário de novo cliente mostra os 3 botões de tipo
- Clicar nos botões de tipo muda o visual (ativo/inativo)

---

### Task 2: JS — Lógica do formulário dinâmico

**Files:**
- Modify: `src/app.js` (funções de formulário)

**Interfaces:**
- Consumes: `#f-tipo`, `#tipo-btn-*`, `#grupo-apartamento-condominio`, `#grupo-contrato` (criados na Task 1)
- Produces:
  - `selecionarTipo(tipo: string): void` — mostra/esconde grupos, atualiza `required`
  - `abrirFormCliente()` atualizado — reseta tipo para `"proprietario"`
  - `editarCliente(idx)` atualizado — pré-seleciona tipo salvo
  - `salvarCliente(e)` atualizado — salva `tipo` + campos condicionais
  - `validarForm()` atualizado — valida apenas campos do tipo ativo

- [ ] **Step 1: Adicionar função `selecionarTipo`**

Logo após a função `limparErrosForm` (linha ~545 do app.js), inserir:

```js
// ---- Seletor de tipo: mostra/esconde grupos de campos ----
function selecionarTipo(tipo) {
  document.getElementById("f-tipo").value = tipo;

  ["proprietario", "inquilino", "outro"].forEach(t => {
    const btn = document.getElementById("tipo-btn-" + t);
    if (btn) btn.classList.toggle("tipo-btn-active", t === tipo);
  });

  const grupoAptCond = document.getElementById("grupo-apartamento-condominio");
  const grupoContrato = document.getElementById("grupo-contrato");
  const aptEl   = document.getElementById("f-apartamento");
  const condEl  = document.getElementById("f-condominio");
  const inicioEl = document.getElementById("f-inicio");
  const terminoEl = document.getElementById("f-termino");

  const mostraAptCond = tipo === "proprietario" || tipo === "inquilino";
  const mostraContrato = tipo === "proprietario";

  if (grupoAptCond) grupoAptCond.style.display = mostraAptCond ? "" : "none";
  if (grupoContrato) grupoContrato.style.display = mostraContrato ? "" : "none";

  if (aptEl)   aptEl.required   = mostraAptCond;
  if (condEl)  condEl.required  = mostraAptCond;
  if (inicioEl) inicioEl.required  = mostraContrato;
  if (terminoEl) terminoEl.required = mostraContrato;
}
```

- [ ] **Step 2: Atualizar `abrirFormCliente`**

Localizar a função `abrirFormCliente` e adicionar a chamada a `selecionarTipo` após o reset:

```js
function abrirFormCliente() {
  document.getElementById("formTitulo").textContent  = "Novo cliente";
  document.getElementById("btnSalvar").textContent   = "Salvar cliente";
  document.getElementById("clienteIndex").value      = -1;
  document.getElementById("formCliente").reset();
  selecionarTipo("proprietario");
  limparErrosForm();
  document.getElementById("modalCliente").style.display = "flex";
  setTimeout(() => document.getElementById("f-nome").focus(), 100);
}
```

- [ ] **Step 3: Atualizar `editarCliente`**

Localizar a função `editarCliente` e:
1. Adicionar leitura do `tipo`
2. Chamar `selecionarTipo` antes de preencher os campos condicionais

```js
function editarCliente(idx) {
  const r = todosOsDados[idx];
  if (!r) return;

  document.getElementById("formTitulo").textContent = "Editar cliente";
  document.getElementById("btnSalvar").textContent  = "Salvar alterações";
  document.getElementById("clienteIndex").value     = idx;

  const tipo = r.tipo || "proprietario";
  selecionarTipo(tipo);

  document.getElementById("f-nome").value      = r.nome;
  document.getElementById("f-telefone").value  = formatarTelefone(r.telefone);
  document.getElementById("f-nascimento").value = r.nascimento;

  if (tipo === "proprietario" || tipo === "inquilino") {
    document.getElementById("f-apartamento").value = r.apartamento || "";
    document.getElementById("f-condominio").value  = r.condominio  || "";
  }
  if (tipo === "proprietario") {
    document.getElementById("f-inicio").value  = r.inicioContrato  || "";
    document.getElementById("f-termino").value = r.terminoContrato || "";
  }

  limparErrosForm();
  document.getElementById("modalCliente").style.display = "flex";
  setTimeout(() => document.getElementById("f-nome").focus(), 100);
}
```

- [ ] **Step 4: Atualizar `salvarCliente`**

Localizar a função `salvarCliente` e substituir a montagem do objeto `cliente`:

```js
async function salvarCliente(e) {
  e.preventDefault();
  if (!validarForm()) return;

  const idx = parseInt(document.getElementById("clienteIndex").value);
  if (idx === -1 && storageExcedido(ESTIMATIVA_CLIENTE)) {
    mostrarToast("❌ Armazenamento cheio. Entre em contato com o administrador.", "err");
    return;
  }

  const tipo = document.getElementById("f-tipo").value || "proprietario";

  const cliente = {
    tipo,
    nome:       document.getElementById("f-nome").value.trim(),
    telefone:   document.getElementById("f-telefone").value.trim(),
    nascimento: document.getElementById("f-nascimento").value.trim(),
  };

  if (tipo === "proprietario" || tipo === "inquilino") {
    cliente.apartamento = document.getElementById("f-apartamento").value.trim();
    cliente.condominio  = document.getElementById("f-condominio").value.trim();
  }
  if (tipo === "proprietario") {
    cliente.inicioContrato  = document.getElementById("f-inicio").value.trim();
    cliente.terminoContrato = document.getElementById("f-termino").value.trim();
  }

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
```

- [ ] **Step 5: Atualizar `validarForm`**

Substituir a função `validarForm` completa:

```js
function validarForm() {
  let ok = true;
  const tipo = document.getElementById("f-tipo").value || "proprietario";

  const camposBase     = ["f-nome", "f-telefone", "f-nascimento"];
  const camposAptCond  = ["f-apartamento", "f-condominio"];
  const camposContrato = ["f-inicio", "f-termino"];

  let campos = [...camposBase];
  if (tipo === "proprietario" || tipo === "inquilino") campos = [...campos, ...camposAptCond];
  if (tipo === "proprietario") campos = [...campos, ...camposContrato];

  campos.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add("input-error");
      ok = false;
    } else {
      el.classList.remove("input-error");
    }
  });

  const camposData = ["f-nascimento"];
  if (tipo === "proprietario") camposData.push("f-inicio", "f-termino");
  camposData.forEach(id => {
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
```

- [ ] **Step 6: Testar formulário**

1. Abrir formulário de novo cliente → tipo padrão "Proprietário" → todos os campos visíveis
2. Clicar em "Inquilino" → campos de contrato somem
3. Clicar em "Outro" → apartamento/condomínio e contrato somem
4. Tentar salvar com campos vazios → erros aparecem nos campos corretos
5. Salvar um cliente de cada tipo → verificar Firestore tem o campo `tipo` correto

---

### Task 3: JS — Abas, filtros e renderização

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `#aba-*`, `#count-*`, `#tableLabel`, `#chip-vencidos` (criados na Task 1); `selecionarTipo` (Task 2)
- Produces:
  - `abaAtiva: string` — variável global nova
  - `setAba(tipo: string): void`
  - `atualizarCabecalhoTabela(tipo: string): void`
  - `atualizarContadoresAbas(): void`
  - `aplicarFiltros()` atualizado — filtra por `abaAtiva`
  - `renderizarTabela(dados)` atualizado — colunas e linhas por aba
  - `atualizarKPIs()` atualizado — vencidos/ativos só de proprietários

- [ ] **Step 1: Adicionar variável `abaAtiva`**

Localizar `let chipAtivo = 'todos';` (linha ~42) e adicionar logo abaixo:

```js
let abaAtiva = "proprietario"; // "proprietario" | "inquilino" | "outro"
```

- [ ] **Step 2: Adicionar funções `setAba`, `atualizarCabecalhoTabela`, `atualizarContadoresAbas`**

Adicionar após a função `setChip` (linha ~327):

```js
// ---- Trocar aba de tipo de cliente ----
function setAba(tipo) {
  abaAtiva  = tipo;
  chipAtivo = "todos";
  paginaAtual = 1;

  ["proprietario", "inquilino", "outro"].forEach(t => {
    const btn = document.getElementById("aba-" + t);
    if (btn) btn.classList.toggle("aba-active", t === tipo);
  });

  const chipsVencidos = document.getElementById("chip-vencidos");
  if (chipsVencidos) chipsVencidos.style.display = tipo === "proprietario" ? "" : "none";

  document.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
  const chipTodos = document.getElementById("chip-todos");
  if (chipTodos) chipTodos.classList.add("chip-active");

  const labels = { proprietario: "Proprietários", inquilino: "Inquilinos", outro: "Outros" };
  const labelEl = document.getElementById("tableLabel");
  if (labelEl) labelEl.textContent = labels[tipo] || tipo;

  atualizarCabecalhoTabela(tipo);
  aplicarFiltros();
}

function atualizarCabecalhoTabela(tipo) {
  const tr = document.querySelector("#tabelaImoveis thead tr");
  if (!tr) return;

  const colunas = {
    proprietario: `<th>Nome</th><th>Telefone</th><th>Apartamento</th><th>Nascimento</th><th>Início contrato</th><th>Término contrato</th><th>Condomínio</th><th>Status</th><th></th>`,
    inquilino:    `<th>Nome</th><th>Telefone</th><th>Apartamento</th><th>Nascimento</th><th>Condomínio</th><th>Status</th><th></th>`,
    outro:        `<th>Nome</th><th>Telefone</th><th>Nascimento</th><th>Status</th><th></th>`,
  };
  tr.innerHTML = colunas[tipo] || colunas.proprietario;
}

function atualizarContadoresAbas() {
  const contadores = { proprietario: 0, inquilino: 0, outro: 0 };
  todosOsDados.forEach(r => {
    const t = r.tipo || "proprietario";
    if (contadores[t] !== undefined) contadores[t]++;
  });
  ["proprietario", "inquilino", "outro"].forEach(t => {
    const el = document.getElementById("count-" + t);
    if (el) el.textContent = contadores[t];
  });
}
```

- [ ] **Step 3: Atualizar `atualizarKPIs`**

Substituir a função `atualizarKPIs` completa:

```js
function atualizarKPIs() {
  const total          = todosOsDados.length;
  const proprietarios  = todosOsDados.filter(r => (r.tipo || "proprietario") === "proprietario");
  const vencidos       = proprietarios.filter(isVencido).length;
  const ativos         = proprietarios.length - vencidos;
  const bdays          = todosOsDados.filter(isAniversariante).length;

  document.getElementById("kpiTotal").textContent            = total;
  document.getElementById("qtdVencidos").textContent         = vencidos;
  document.getElementById("kpiAtivos").textContent           = ativos;
  document.getElementById("kpiAniversariantes").textContent  = bdays;

  atualizarContadoresAbas();
}
```

- [ ] **Step 4: Atualizar `aplicarFiltros`**

Substituir a função `aplicarFiltros` completa:

```js
function aplicarFiltros(termoBusca) {
  const termo = termoBusca !== undefined
    ? termoBusca
    : document.getElementById("campoPesquisa").value.toLowerCase().trim();

  let base = todosOsDados.filter(r => (r.tipo || "proprietario") === abaAtiva);

  if (chipAtivo === "vencidos") {
    base = base.filter(isVencido);
  } else if (chipAtivo === "aniversariantes") {
    base = base.filter(isAniversariante);
  }

  if (termo) {
    base = base.filter(r => Object.values(r).some(v => typeof v === "string" && v.toLowerCase().includes(termo)));
  }

  dadosFiltrados = base;
  paginaAtual = 1;
  renderizarTabela(dadosFiltrados);
}
```

- [ ] **Step 5: Atualizar `renderizarTabela` para colunas e linhas por tipo**

Substituir o trecho dentro de `paginaDados.forEach(r => { ... })` (o `tr.innerHTML = ...`):

```js
paginaDados.forEach(r => {
  const tr = document.createElement("tr");
  const vencido     = abaAtiva === "proprietario" && isVencido(r);
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

  const idx = todosOsDados.indexOf(r);

  const acoes = `
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
    </td>`;

  if (abaAtiva === "proprietario") {
    tr.innerHTML = `
      <td>${r.nome}</td>
      <td>${r.telefone}</td>
      <td>${r.apartamento || "—"}</td>
      <td>${r.nascimento || "—"}</td>
      <td>${r.inicioContrato || "—"}</td>
      <td>${r.terminoContrato || "—"}</td>
      <td>${r.condominio || "—"}</td>
      <td>${statusBadge}</td>
      ${acoes}`;
  } else if (abaAtiva === "inquilino") {
    tr.innerHTML = `
      <td>${r.nome}</td>
      <td>${r.telefone}</td>
      <td>${r.apartamento || "—"}</td>
      <td>${r.nascimento || "—"}</td>
      <td>${r.condominio || "—"}</td>
      <td>${statusBadge}</td>
      ${acoes}`;
  } else {
    tr.innerHTML = `
      <td>${r.nome}</td>
      <td>${r.telefone}</td>
      <td>${r.nascimento || "—"}</td>
      <td>${statusBadge}</td>
      ${acoes}`;
  }

  tbody.appendChild(tr);
});
```

- [ ] **Step 6: Testar abas e filtros**

1. Abrir Dashboard → aba "Proprietários" ativa por padrão, colunas corretas
2. Clicar "Inquilinos" → colunas sem contrato, chip "Vencidos" some
3. Clicar "Outros" → colunas só Nome/Telefone/Nascimento/Status
4. Chip "Aniversários" funciona em todas as abas
5. Chip "Vencidos" só aparece e funciona na aba Proprietários
6. Pesquisa filtra apenas dentro da aba ativa

---

### Task 4: JS — Disparo em lote (subtítulo e sugestão de contrato vencido)

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `todosOsDados` (todos os tipos), `isVencido`, `isAniversariante`
- Produces: subtítulo correto por tipo no modal de disparo; `contrato_vencido` filtra só proprietários

- [ ] **Step 1: Atualizar `abrirModalMensagemDirect` — subtítulo sem apartamento**

Localizar dentro de `abrirModalMensagemDirect`, a linha que monta o `disparo-item-sub`:

```js
// Localizar e substituir:
<div class="disparo-item-sub">Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}</div>
```

Por:

```js
<div class="disparo-item-sub">${c.apartamento ? `Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}` : `${c.telefone}`}</div>
```

Há duas ocorrências idênticas nessa função — ambas precisam ser atualizadas.

- [ ] **Step 2: Atualizar `aplicarSugestao` — contrato vencido só proprietários; subtítulos**

Localizar dentro de `aplicarSugestao`:

1. A linha `clientes = todosOsDados.filter(isVencido);` e substituir por:
```js
clientes = todosOsDados.filter(r => (r.tipo || "proprietario") === "proprietario").filter(isVencido);
```

2. Localizar as linhas que montam `disparo-item-sub` dentro da função (após o `if(tipo === "livre")`) e substituir as 2 ocorrências por:
```js
<div class="disparo-item-sub">${c.apartamento ? `Apto ${c.apartamento} · ${c.telefone}${c.condominio ? ' · ' + c.condominio : ''}` : `${c.telefone}`}</div>
```

- [ ] **Step 3: Testar disparo**

1. Abrir modal de disparo → sugestão "Livre" → todos os clientes listados; subtítulo correto por tipo
2. Sugestão "Contrato Vencido" → mostra só proprietários com contrato vencido
3. Sugestão "Aniversário" → mostra clientes de todos os tipos
