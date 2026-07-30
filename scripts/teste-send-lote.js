// ============================================================
//  teste-lote-70.js
//  Simula um disparo de 70 mensagens para o MESMO número,
//  para validar que o fluxo de lote grande funciona sem travar.
//
//  Uso:
//    node scripts/teste-lote-70.js
//
//  Requisitos:
//    - Servidor rodando em http://localhost:3000
//    - WhatsApp conectado (status "pronto")
// ============================================================

const http = require("http");

const NUMERO_TESTE = "5581995299043"; // seu número com DDI
const QUANTIDADE = 10;
const SERVER_URL = "http://localhost:3000";

// Gera 70 mensagens diferentes (simula clientes distintos)
const mensagens = [];
for (let i = 1; i <= QUANTIDADE; i++) {
  mensagens.push({
    telefone: NUMERO_TESTE,
    mensagem: `Teste de lote #${i}/${QUANTIDADE} — se recebeu essa mensagem, o disparo em massa está funcionando corretamente. (${new Date().toLocaleTimeString("pt-BR")})`,
    nome: `Cliente Teste ${i}`,
  });
}

const payload = JSON.stringify({ mensagens, fotos: [] });

const options = {
  hostname: "localhost",
  port: 3000,
  path: "/api/send-batch",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  },
};

console.log(`\n🚀 Enviando lote de ${QUANTIDADE} mensagens para ${NUMERO_TESTE}...`);
console.log(`   Servidor: ${SERVER_URL}`);
console.log(`   Acompanhe o progresso no modal do app (ou via socket "disparo:progresso")\n`);

const req = http.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const data = JSON.parse(body);
      if (data.ok) {
        console.log(`✅ Job iniciado com sucesso!`);
        console.log(`   jobId: ${data.jobId}`);
        console.log(`   total: ${data.total} mensagens`);
        console.log(`\n   O envio está rodando em background.`);
        console.log(`   Abra o app e veja o progresso em tempo real no modal.`);
        console.log(`   Tempo estimado: ~15-20 min com anti-ban ligado, ~5 min desligado.\n`);
      } else {
        console.error(`❌ Erro ao iniciar lote: ${data.erro}`);
      }
    } catch (e) {
      console.error(`❌ Resposta inesperada do servidor (HTTP ${res.statusCode}):`);
      console.error(body);
    }
  });
});

req.on("error", (err) => {
  console.error(`❌ Não foi possível conectar ao servidor em ${SERVER_URL}`);
  console.error(`   Erro: ${err.message}`);
  console.error(`\n   Verifique se o app está aberto e o servidor rodando.`);
});

req.write(payload);
req.end();
