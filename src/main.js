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

  // Tenta sempre a porta preferida (3000) para que a origem http://localhost:3000
  // seja consistente entre reinicializações — necessário para o Firebase Auth
  // persistir a sessão no IndexedDB sem pedir login toda vez.
  function findPreferredPort(preferred = 3000) {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", () => {
        // Porta preferida ocupada → pega qualquer porta livre como fallback
        const fallback = net.createServer();
        fallback.unref();
        fallback.on("error", reject);
        fallback.listen(0, () => {
          const port = fallback.address().port;
          fallback.close(() => resolve(port));
        });
      });
      probe.listen(preferred, () => {
        probe.close(() => resolve(preferred));
      });
    });
  }

  function findChromiumPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

    // ── Windows: procura Chrome ou Edge instalado no sistema ──────────────
    if (process.platform === "win32") {
      const pf   = process.env["PROGRAMFILES"]       || "C:\\Program Files";
      const pf86 = process.env["PROGRAMFILES(X86)"]  || "C:\\Program Files (x86)";
      const local = process.env["LOCALAPPDATA"]       || "";

      const candidates = [
        // Google Chrome
        path.join(pf,   "Google\\Chrome\\Application\\chrome.exe"),
        path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
        path.join(local,"Google\\Chrome\\Application\\chrome.exe"),
        // Microsoft Edge (pré-instalado em todos os Windows 10/11)
        path.join(pf,   "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(local,"Microsoft\\Edge\\Application\\msedge.exe"),
      ];

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          console.log("[main] Usando browser do sistema (Windows):", p);
          return p;
        }
      }

      console.error("[main] Nenhum Chrome/Edge encontrado no Windows!");
      return "";
    }

    // ── macOS/Linux: prefere o Chrome do cache do puppeteer ───────────────
    try {
      const puppeteer = require("puppeteer");
      const p = puppeteer.executablePath();
      if (p && fs.existsSync(p)) {
        console.log("[main] Usando Chrome do puppeteer cache:", p);
        return p;
      }
    } catch (_) {}

    // Fallback: Chrome bundled no app (macOS)
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
        serverPort = await findPreferredPort(3000);
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
      show: false,               // não exibe até o conteúdo estar pronto
      backgroundColor: "#f4f6fb", // evita flash branco enquanto carrega
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        zoomFactor: 1.0,
      },
    });

    // Exibe a janela apenas quando a página estiver totalmente renderizada.
    // Usa múltiplos gatilhos + timeout de segurança para NUNCA ficar oculta
    // (no Windows o "ready-to-show" às vezes não dispara → janela fantasma).
    let shown = false;
    const showWindow = () => {
      if (shown || !mainWindow) return;
      shown = true;
      mainWindow.show();
      mainWindow.focus();
    };

    mainWindow.once("ready-to-show", showWindow);
    mainWindow.webContents.once("did-finish-load", showWindow);
    // Fallback final: força a exibição após 8s mesmo se algo falhar
    const showFallback = setTimeout(showWindow, 8000);

    // Se a página falhar ao carregar, mostra a janela mesmo assim (não deixa oculta)
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      console.error(`[main] Falha ao carregar a página (${code}): ${desc}`);
      showWindow();
    });

    mainWindow.on("closed", () => {
      clearTimeout(showFallback);
      mainWindow = null;
    });

    // Corrige DPI scaling no Windows (evita layout borrado/quebrado em telas 150%)
    if (process.platform === "win32") {
      mainWindow.webContents.setZoomFactor(1.0);
      mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.setZoomFactor(1.0);
      });
    }

    mainWindow.loadURL(`http://localhost:${serverPort}`);
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
