# Design: Tipos de Cliente

**Data:** 2026-08-05  
**Escopo:** Lista de clientes — suporte a múltiplos tipos com formulário dinâmico e abas separadas

---

## Contexto

O app atual trata todos os clientes como proprietários/inquilinos com um único formulário e uma única tabela. O objetivo é suportar três tipos distintos com campos e visualizações diferentes.

---

## Tipos de Cliente

| Tipo | Valor no Firestore |
|---|---|
| Sócio/Proprietário | `"proprietario"` |
| Inquilino | `"inquilino"` |
| Outro | `"outro"` |

Registros existentes sem campo `tipo` são tratados como `"proprietario"` via fallback (`r.tipo || "proprietario"`). Sem migração de dados.

---

## Campos por Tipo

| Campo | Proprietário | Inquilino | Outro |
|---|---|---|---|
| Nome | ✅ obrigatório | ✅ | ✅ |
| Telefone | ✅ obrigatório | ✅ | ✅ |
| Data de nascimento | ✅ obrigatório | ✅ | ✅ |
| Apartamento | ✅ obrigatório | ✅ | — |
| Condomínio | ✅ obrigatório | ✅ | — |
| Início do contrato | ✅ obrigatório | — | — |
| Término do contrato | ✅ obrigatório | — | — |

---

## Formulário (modal `#modalCliente`)

- Seletor de tipo no topo: 3 botões estilo segmented control (`Proprietário | Inquilino | Outro`)
- Campo hidden `#f-tipo` armazena o valor selecionado
- Ao trocar o tipo, JS mostra/esconde grupos de campos via `display:none` e adiciona/remove `required` dinamicamente
- Grupos de campos: `#grupo-apartamento-condominio`, `#grupo-contrato`
- Ao abrir para edição, o tipo salvo é pré-selecionado e os campos corretos são exibidos
- `limparFormCliente()` reseta o seletor para `"proprietario"` e restaura o estado padrão dos campos

---

## Abas e Tabelas

Substituem os chips de filtro de tipo. As abas ficam acima da tabela.

### Aba Proprietários
- Chips: Todos · Vencidos · Aniversários  
- Colunas: Nome · Telefone · Apartamento · Nascimento · Início · Término · Condomínio · Status
- Status badge: `Ativo` / `Vencido` / `Aniversário`

### Aba Inquilinos
- Chips: Todos · Aniversários  
- Colunas: Nome · Telefone · Apartamento · Nascimento · Condomínio · Status
- Status badge: `Ativo` / `Aniversário`

### Aba Outros
- Sem chips de filtro
- Colunas: Nome · Telefone · Nascimento · Status
- Status badge: `Ativo` / `Aniversário`

Cada aba exibe o total entre parênteses: ex. `Proprietários (12)`.

---

## Lógica de Filtros (chips)

- `isVencido(r)` só é aplicado em clientes do tipo `"proprietario"`
- `isAniversariante(r)` se aplica a todos os tipos
- O chip "Vencidos" não aparece nas abas Inquilinos e Outros

---

## Disparo em Lote

- Continua usando `todosOsDados` (todos os tipos juntos)
- Item da lista de disparo: se não tem `apartamento`, exibe o tipo como subtítulo (ex: "Outro · (81) 99999-9999")
- Sem alterações na lógica de envio

---

## Firestore

Coleção: `clientes` (sem mudança)  
Campo novo: `tipo` (string) — salvo junto com os demais campos no `salvarCliente()`  
Nenhuma migração necessária: fallback `r.tipo || "proprietario"` cobre registros antigos

---

## Arquivos Alterados

| Arquivo | O que muda |
|---|---|
| `src/app.html` | Seletor de tipo no form; abas acima da tabela; ajuste de colunas por aba |
| `src/app.js` | `salvarCliente`, `editarCliente`, `limparFormCliente`, `renderizarTabela`, `setChip`, contadores, lógica de disparo |
