const { app, BrowserWindow, dialog } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");

let serverProcess = null;
let mainWindow = null;
let serverPort = null;
let serverReady = false;

// ── Garante UMA única instância ──────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Já existe uma instância rodando → encerra esta imediatamente
  app.quit();
} else {
  // ── Segunda instância tentou abrir → foca a janela existente ──
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ── Funções auxiliares ───────────────────────────────────────────────────
  function findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  function findChromiumPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

    // 1. Prefere o Chrome do cache do puppeteer — funciona de forma confiável no macOS
    try {
      const puppeteer = require("puppeteer");
      const p = puppeteer.executablePath();
      if (p && fs.existsSync(p)) {
        console.log("[main] Usando Chrome do puppeteer cache:", p);
        return p;
      }
    } catch (_) {}

    // 2. Fallback: Chrome bundled no app (pode não funcionar quando aninhado em outro bundle)
    const dirs = [
      path.join(process.resourcesPath || "", "chromium"),
      path.join(process.resourcesPath || "", "app.asar.unpacked", "resources", "chromium"),
      path.join(app.getAppPath(), "resources", "chromium"),
    ];
    for (const dir of dirs) {
      const p = path.join(dir, "Contents", "MacOS", "Google Chrome for Testing");
      if (fs.existsSync(p)) {
        try {
          execSync(`xattr -dr com.apple.quarantine ${JSON.stringify(dir)}`, { timeout: 5000 });
        } catch (_) {}
        console.log("[main] Usando Chrome bundled:", p);
        return p;
      }
    }

    return "";
  }

  function startServer() {
    return new Promise(async (resolve, reject) => {
      try {
        serverPort = await findFreePort();
      } catch (err) {
        return reject(new Error("Não foi possível encontrar uma porta livre"));
      }

      const nodeBin = process.execPath;
      const serverPath = path.join(__dirname, "server.js");
      const chromPath = findChromiumPath();
      const env = {
        PORT: serverPort.toString(),
        WA_SESSION_PATH: path.join(app.getPath("userData"), ".wwebjs_auth"),
        CHROMIUM_PATH: chromPath,
      };

      serverProcess = spawn(nodeBin, [serverPath], {
        // ELECTRON_RUN_AS_NODE=1 faz o binário Electron agir como Node.js puro
        // sem isso, o processo filho ativaria o single-instance-lock e encerraria
        env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        windowsHide: true,
      });

      serverProcess.stdout.on("data", (data) => {
        console.log(`[server] ${data.toString().trim()}`);
      });

      serverProcess.stderr.on("data", (data) => {
        console.error(`[server] ${data.toString().trim()}`);
      });

      serverProcess.on("error", reject);
      serverProcess.on("exit", (code) => {
        console.log(`Servidor encerrou (código ${code})`);
        serverProcess = null;
      });

      const timeout = setTimeout(() => {
        reject(new Error("Servidor não iniciou em 30s"));
      }, 30000);

      let resolved = false;
      function check() {
        if (resolved) return;
        http.get(`http://localhost:${serverPort}`, () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }).on("error", () => {
          if (!resolved) setTimeout(check, 500);
        });
      }

      setTimeout(check, 1000);
    });
  }

  function createWindow() {
    if (mainWindow) return; // já existe uma janela
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: "Tech Corretor",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    mainWindow.loadURL(`http://localhost:${serverPort}`);
    mainWindow.on("closed", () => { mainWindow = null; });
  }

  // ── Inicialização ────────────────────────────────────────────────────────
  app.whenReady().then(async () => {
    try {
      await startServer();
      serverReady = true;
      createWindow();
    } catch (err) {
      dialog.showErrorBox("Erro", `Não foi possível iniciar o servidor:\n${err.message}`);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // No macOS: só recria a janela se o servidor já estiver pronto
  app.on("activate", () => {
    if (serverReady && mainWindow === null) {
      createWindow();
    }
  });

  app.on("before-quit", () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
}
