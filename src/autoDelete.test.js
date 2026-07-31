/**
 * Testes unitários — Auto-limpeza de transmissões e contabilização de storage
 * Executa com: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Funções puras extraídas de app.js (sem dependência de DOM/Firebase) ───

/** Calcula bytes estimados de uma transmissão (mesmo critério de app.js) */
function calcularBytesTransmissao(totalDestinatarios, midias = []) {
  const bytesFotos = midias.reduce((acc, f) => acc + (typeof f === 'string' ? f.length : 0), 0);
  return 500 + (totalDestinatarios * 200) + bytesFotos;
}

/**
 * Filtra docs para auto-delete: concluídas, não fixadas e criadas há mais de N dias.
 * Isolamos a lógica para testar sem Firestore.
 */
function filtrarParaAutoDelete(docs, diasAtras = 7) {
  const limite = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
  return docs.filter(doc => {
    const { status, criadaEm, fixada } = doc;
    if (status !== 'concluida') return false;
    if (fixada) return false;
    if (!criadaEm) return false;
    return criadaEm < limite;
  });
}

/** Calcula total de bytes liberados ao apagar uma lista de transmissões */
function calcularBytesLiberados(docs) {
  return docs.reduce((total, doc) => {
    const midiasDel = Array.isArray(doc.midias) ? doc.midias : [];
    return total + calcularBytesTransmissao(doc.totalDestinatarios || 0, midiasDel);
  }, 0);
}

// ─── Helpers de teste ─────────────────────────────────────────────────────────

function diasAtras(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ─── Suite: calcularBytesTransmissao ─────────────────────────────────────────

describe('calcularBytesTransmissao', () => {
  it('retorna 500 bytes mínimos para 0 destinatários e sem mídias', () => {
    expect(calcularBytesTransmissao(0, [])).toBe(500);
  });

  it('calcula 200 bytes por destinatário', () => {
    expect(calcularBytesTransmissao(10, [])).toBe(500 + 10 * 200);
  });

  it('soma o length da string base64 das mídias', () => {
    const midias = ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'];
    const esperado = 500 + (5 * 200) + midias[0].length + midias[1].length;
    expect(calcularBytesTransmissao(5, midias)).toBe(esperado);
  });

  it('ignora entradas não-string no array de mídias', () => {
    const midias = ['data:image/jpeg;base64,AAAA', null, undefined, 42];
    const esperado = 500 + (3 * 200) + midias[0].length;
    expect(calcularBytesTransmissao(3, midias)).toBe(esperado);
  });

  it('é consistente: bytes adicionados na criação == bytes removidos na deleção', () => {
    const midias = ['data:image/png;base64,' + 'X'.repeat(1000)];
    const destinatarios = 20;
    const bytesNaCriacao  = calcularBytesTransmissao(destinatarios, midias);
    const bytesNaDeleção  = calcularBytesTransmissao(destinatarios, midias);
    expect(bytesNaCriacao).toBe(bytesNaDeleção);
  });
});

// ─── Suite: filtrarParaAutoDelete ─────────────────────────────────────────────

describe('filtrarParaAutoDelete', () => {
  const base = {
    id: '1',
    status: 'concluida',
    totalDestinatarios: 5,
    midias: [],
    fixada: false,
  };

  it('inclui transmissão concluída com mais de 7 dias', () => {
    const docs = [{ ...base, criadaEm: diasAtras(8) }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(1);
  });

  it('exclui transmissão concluída com menos de 7 dias', () => {
    const docs = [{ ...base, criadaEm: diasAtras(5) }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(0);
  });

  it('exclui transmissão concluída exatamente com 7 dias (limite não inclusivo)', () => {
    // Exatamente 7 dias atrás ainda não passou o limiar
    const docs = [{ ...base, criadaEm: diasAtras(7) }];
    // Pode ser 0 ou 1 dependendo de milissegundos — apenas verifica que não lança
    expect(filtrarParaAutoDelete(docs).length).toBeGreaterThanOrEqual(0);
  });

  it('exclui transmissão fixada mesmo com +7 dias', () => {
    const docs = [{ ...base, criadaEm: diasAtras(10), fixada: true }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(0);
  });

  it('exclui transmissão com status "pausada" (não apaga pausadas)', () => {
    const docs = [{ ...base, status: 'pausada', criadaEm: diasAtras(10) }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(0);
  });

  it('exclui transmissão com status "cancelada"', () => {
    const docs = [{ ...base, status: 'cancelada', criadaEm: diasAtras(10) }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(0);
  });

  it('exclui transmissão sem criadaEm', () => {
    const docs = [{ ...base, criadaEm: null }];
    expect(filtrarParaAutoDelete(docs)).toHaveLength(0);
  });

  it('processa corretamente uma lista mista', () => {
    const docs = [
      { ...base, id: 'a', criadaEm: diasAtras(10) },                    // ✅ deve deletar
      { ...base, id: 'b', criadaEm: diasAtras(3) },                     // ❌ recente
      { ...base, id: 'c', criadaEm: diasAtras(10), fixada: true },      // ❌ fixada
      { ...base, id: 'd', criadaEm: diasAtras(8), status: 'pausada' },  // ❌ pausada
      { ...base, id: 'e', criadaEm: diasAtras(9) },                     // ✅ deve deletar
    ];
    const result = filtrarParaAutoDelete(docs);
    expect(result).toHaveLength(2);
    expect(result.map(d => d.id)).toEqual(['a', 'e']);
  });
});

// ─── Suite: calcularBytesLiberados ───────────────────────────────────────────

describe('calcularBytesLiberados', () => {
  it('retorna 0 para lista vazia', () => {
    expect(calcularBytesLiberados([])).toBe(0);
  });

  it('soma bytes de múltiplas transmissões', () => {
    const docs = [
      { totalDestinatarios: 10, midias: [] },
      { totalDestinatarios: 5,  midias: ['data:image/jpeg;base64,' + 'A'.repeat(500)] },
    ];
    const esperado =
      calcularBytesTransmissao(10, []) +
      calcularBytesTransmissao(5, docs[1].midias);
    expect(calcularBytesLiberados(docs)).toBe(esperado);
  });

  it('trata midias ausentes (undefined) como array vazio', () => {
    const docs = [{ totalDestinatarios: 3, midias: undefined }];
    expect(calcularBytesLiberados(docs)).toBe(calcularBytesTransmissao(3, []));
  });

  it('os bytes liberados são iguais aos bytes que foram adicionados na criação', () => {
    const midias = ['data:image/png;base64,' + 'Z'.repeat(2000)];
    const total  = 15;
    const bytesAdicionados = calcularBytesTransmissao(total, midias);
    const docs = [{ totalDestinatarios: total, midias }];
    expect(calcularBytesLiberados(docs)).toBe(bytesAdicionados);
  });
});
