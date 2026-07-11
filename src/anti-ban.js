// =============================================
//  Tech Corretor – anti-ban.js
//  Estratégias anti-ban para WhatsApp Web
// =============================================

/**
 * Estratégias implementadas:
 * 1. Delay humanizado (aleatório, com variação gaussiana)
 * 2. Limite diário de mensagens (reseta à meia-noite)
 * 3. Limite por hora (janela deslizante)
 * 4. Pausa obrigatória após X mensagens seguidas
 * 5. Horário comercial (evita envios de madrugada)
 * 6. Variação de texto (quebra padrão de mensagem idêntica)
 * 7. Simulação de digitação (typing indicator)
 */

// ── Configuração padrão (pode ser sobrescrita) ─────────────────────────────
const CONFIG = {
  // Limites de volume
  limiteDiario: 200,          // máx mensagens por dia (conservador)
  limitePorHora: 30,          // máx mensagens por hora (janela deslizante)

  // Delays entre mensagens (em ms)
  delayMin: 4000,             // mínimo 4s entre msgs
  delayMax: 12000,            // máximo 12s entre msgs
  delayEntreGrupos: 30000,    // pausa maior a cada N mensagens (30s)
  mensagensAntesDeGrupo: 8,   // a cada 8 msgs, faz pausa longa

  // Pausa longa obrigatória
  pausaLongaMin: 45000,       // 45s mínimo na pausa longa
  pausaLongaMax: 90000,       // 90s máximo na pausa longa

  // Horário permitido para envio (evita madrugada)
  horarioInicio: 8,           // 08:00
  horarioFim: 21,             // 21:00

  // Simulação de digitação
  typingDuration: { min: 1500, max: 4000 }, // tempo que fica "digitando"

  // Variação de texto
  variacaoTexto: true,        // adiciona variações sutis ao texto
};

// ── Estado do rate limiter ──────────────────────────────────────────────────
let _contadorDiario = 0;
let _diaAtual = new Date().toDateString();
let _historicoHora = [];       // timestamps das msgs na última hora
let _contadorSequencial = 0;   // msgs desde a última pausa longa
let _ultimoEnvio = 0;         // timestamp do último envio

// ── Funções utilitárias ─────────────────────────────────────────────────────

/**
 * Delay aleatório com distribuição mais "humana" (tendência ao meio)
 */
function delayHumanizado(min = CONFIG.delayMin, max = CONFIG.delayMax) {
  // Usa soma de 2 randoms para criar distribuição triangular (mais natural)
  const r = (Math.random() + Math.random()) / 2;
  const delay = min + r * (max - min);
  // Adiciona jitter de ±15% para nunca ser previsível
  const jitter = delay * (0.85 + Math.random() * 0.30);
  return Math.round(jitter);
}

/**
 * Sleep com delay humanizado
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reseta o contador diário se mudou o dia
 */
function verificarResetDiario() {
  const hoje = new Date().toDateString();
  if (hoje !== _diaAtual) {
    _diaAtual = hoje;
    _contadorDiario = 0;
    _contadorSequencial = 0;
    _historicoHora = [];
  }
}

/**
 * Limpa timestamps com mais de 1h do histórico
 */
function limparHistoricoHora() {
  const umaHoraAtras = Date.now() - 3600000;
  _historicoHora = _historicoHora.filter(ts => ts > umaHoraAtras);
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Verifica se pode enviar mensagem agora.
 * Retorna { permitido: boolean, motivo?: string, aguardarMs?: number }
 */
function podeEnviar() {
  verificarResetDiario();
  limparHistoricoHora();

  // 1. Limite diário
  if (_contadorDiario >= CONFIG.limiteDiario) {
    return {
      permitido: false,
      motivo: `Limite diário atingido (${CONFIG.limiteDiario} mensagens). Tente novamente amanhã.`,
      aguardarMs: null
    };
  }

  // 2. Limite por hora
  if (_historicoHora.length >= CONFIG.limitePorHora) {
    const maisAntiga = _historicoHora[0];
    const aguardar = maisAntiga + 3600000 - Date.now();
    return {
      permitido: false,
      motivo: `Limite por hora atingido (${CONFIG.limitePorHora}/h). Aguarde ${Math.ceil(aguardar / 60000)} min.`,
      aguardarMs: aguardar > 0 ? aguardar : 1000
    };
  }

  // 3. Horário comercial
  const hora = new Date().getHours();
  if (hora < CONFIG.horarioInicio || hora >= CONFIG.horarioFim) {
    return {
      permitido: false,
      motivo: `Fora do horário permitido (${CONFIG.horarioInicio}h–${CONFIG.horarioFim}h). Envios bloqueados para proteger o número.`,
      aguardarMs: null
    };
  }

  return { permitido: true };
}

/**
 * Calcula o delay ideal antes do próximo envio.
 * Leva em conta: tempo desde o último envio, pausa de grupo, delay base.
 */
function calcularDelay() {
  _contadorSequencial++;

  // Pausa longa a cada N mensagens
  if (_contadorSequencial >= CONFIG.mensagensAntesDeGrupo) {
    _contadorSequencial = 0;
    return delayHumanizado(CONFIG.pausaLongaMin, CONFIG.pausaLongaMax);
  }

  // Delay normal humanizado
  return delayHumanizado(CONFIG.delayMin, CONFIG.delayMax);
}

/**
 * Registra que uma mensagem foi enviada (atualiza contadores).
 * Chamar APÓS o envio bem-sucedido.
 */
function registrarEnvio() {
  verificarResetDiario();
  _contadorDiario++;
  _historicoHora.push(Date.now());
  _ultimoEnvio = Date.now();
}

/**
 * Simula "digitando..." antes de enviar.
 * Torna o comportamento mais humano no WhatsApp do destinatário.
 */
async function simularDigitacao(clienteWA, chatId) {
  try {
    const chat = await clienteWA.getChatById(chatId);
    if (chat) {
      await chat.sendStateTyping();
      const duracao = CONFIG.typingDuration.min +
        Math.random() * (CONFIG.typingDuration.max - CONFIG.typingDuration.min);
      await sleep(Math.round(duracao));
      await chat.clearState();
    }
  } catch (_) {
    // Se falhar (chat não encontrado, etc.), não impede o envio
  }
}

/**
 * Adiciona variações sutis ao texto para não enviar mensagens idênticas.
 * Usa caracteres invisíveis e variações de pontuação.
 */
function variarTexto(texto) {
  if (!CONFIG.variacaoTexto || !texto) return texto;

  let resultado = texto;

  // 1. Espaço de largura zero aleatório (invisível mas muda o hash)
  const posicoes = [
    Math.floor(Math.random() * resultado.length),
    Math.floor(Math.random() * resultado.length),
  ];
  const zwsp = '\u200B'; // zero-width space
  posicoes.forEach(pos => {
    if (pos > 0 && pos < resultado.length - 1) {
      resultado = resultado.slice(0, pos) + zwsp + resultado.slice(pos);
    }
  });

  // 2. Variação de pontuação no final (50% de chance)
  if (Math.random() > 0.5) {
    if (resultado.endsWith('.')) {
      // Às vezes remove o ponto, às vezes não muda nada
      if (Math.random() > 0.5) resultado = resultado.slice(0, -1);
    } else if (!resultado.endsWith('!') && !resultado.endsWith('?')) {
      // Às vezes adiciona ponto
      if (Math.random() > 0.7) resultado += '.';
    }
  }

  // 3. Variação de quebra de linha (adiciona ou remove espaço no fim)
  if (Math.random() > 0.6) {
    resultado = resultado.trimEnd() + (Math.random() > 0.5 ? ' ' : '');
  }

  return resultado;
}

/**
 * Retorna o status atual do anti-ban para exibir no frontend.
 */
function getStatus() {
  verificarResetDiario();
  limparHistoricoHora();

  return {
    contadorDiario: _contadorDiario,
    limiteDiario: CONFIG.limiteDiario,
    enviosUltimaHora: _historicoHora.length,
    limitePorHora: CONFIG.limitePorHora,
    contadorSequencial: _contadorSequencial,
    proximaPausaEm: CONFIG.mensagensAntesDeGrupo - _contadorSequencial,
    horarioPermitido: (() => {
      const hora = new Date().getHours();
      return hora >= CONFIG.horarioInicio && hora < CONFIG.horarioFim;
    })(),
    horarioInicio: CONFIG.horarioInicio,
    horarioFim: CONFIG.horarioFim,
    ultimoEnvio: _ultimoEnvio ? new Date(_ultimoEnvio).toLocaleTimeString("pt-BR") : "—",
  };
}

/**
 * Permite atualizar configurações em tempo de execução.
 */
function atualizarConfig(novaConfig) {
  Object.assign(CONFIG, novaConfig);
}

/**
 * Retorna a configuração atual.
 */
function getConfig() {
  return { ...CONFIG };
}

module.exports = {
  podeEnviar,
  calcularDelay,
  registrarEnvio,
  simularDigitacao,
  variarTexto,
  delayHumanizado,
  sleep,
  getStatus,
  getConfig,
  atualizarConfig,
};
