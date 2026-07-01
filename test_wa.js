// Script de teste: dispara wa:iniciar e captura todos os logs por 30s
const { io } = require("socket.io-client");

const PORT = process.argv[2] || 3099;
const socket = io(`http://localhost:${PORT}`);

console.log(`Conectando em localhost:${PORT}...`);

socket.on("connect", () => {
  console.log("✅ Conectado ao servidor. Disparando wa:iniciar...");
  socket.emit("wa:iniciar");
});

socket.on("wa:status", (data) => {
  console.log("📡 wa:status:", JSON.stringify(data));
  if (data.status === "erro" || data.status === "pronto" || data.status === "qr") {
    setTimeout(() => { socket.disconnect(); process.exit(0); }, 1000);
  }
});

socket.on("wa:qr", () => console.log("📱 QR Code gerado!"));
socket.on("connect_error", (e) => console.error("❌ Erro de conexão:", e.message));

setTimeout(() => {
  console.log("TIMEOUT 30s - encerrando");
  socket.disconnect();
  process.exit(1);
}, 30000);
