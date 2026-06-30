const { app, BrowserWindow, dialog } = require("electron");
const { fork } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");

let serverProcess = null;
let mainWindow = null;
let serverPort = null;

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
  const candidates = [
    path.join(process.resourcesPath || "", "chromium"),
    path.join(app.getAppPath(), "resources", "chromium"),
  ];
  for (const dir of candidates) {
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const entry of entries) {
      const p = path.join(dir, entry, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
      if (fs.existsSync(p)) return p;
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

    const env = {
      ...process.env,
      PORT: serverPort.toString(),
      WA_SESSION_PATH: path.join(app.getPath("userData"), ".wwebjs_auth"),
      CHROMIUM_PATH: findChromiumPath(),
    };

    serverProcess = fork(path.join(__dirname, "server.js"), [], {
      env,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
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

    function check() {
      http.get(`http://localhost:${serverPort}`, (res) => {
        clearTimeout(timeout);
        resolve();
      }).on("error", () => {
        setTimeout(check, 500);
      });
    }

    setTimeout(check, 1000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "LF Imóveis",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    await startServer();
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

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
