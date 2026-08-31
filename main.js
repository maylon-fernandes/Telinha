const { app, BrowserWindow, ipcMain, desktopCapturer, Menu, globalShortcut, shell } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.forceDevUpdateConfig = false;
autoUpdater.disableDifferentialDownload = true;
autoUpdater.logger = {
  info: (msg) => console.log("[updater]", msg),
  warn: (msg) => console.warn("[updater]", msg),
  error: (msg) => console.error("[updater]", msg),
  debug: () => {},
};
autoUpdater.setFeedURL({
  provider: "github",
  owner: "maylon-fernandes",
  repo: "Telinha",
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "electron", "favicon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "electron", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  globalShortcut.register("F12", () => {
    mainWindow?.webContents.toggleDevTools();
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("checkForUpdates failed:", err);
    });
  }, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  app.quit();
});

autoUpdater.on("update-available", (info) => {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", "available", info.version);
  }
});

autoUpdater.on("download-progress", (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", "downloading", Math.round(progress.percent));
  }
});

autoUpdater.on("update-downloaded", () => {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", "downloaded");
  }
});

autoUpdater.on("error", (err) => {
  console.error("AutoUpdater error:", err);
});

autoUpdater.on("update-not-available", () => {
  console.log("[updater] No update available");
});

autoUpdater.on("checking-for-update", () => {
  console.log("[updater] Checking for updates...");
});

ipcMain.on("win-minimize", () => mainWindow?.minimize());
ipcMain.on("win-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("win-close", () => mainWindow?.close());
ipcMain.on("install-update", () => autoUpdater.quitAndInstall());

ipcMain.handle("get-desktop-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  } catch (err) {
    console.error("Erro ao obter fontes de captura:", err);
    return [];
  }
});

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("open-external", (_, url) => shell.openExternal(url));
