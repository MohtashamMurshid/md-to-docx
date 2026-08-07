import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#0b0c0f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const currentDocument = window.webContents.getURL().split("#")[0];
    if (url === currentDocument || url.startsWith(`${currentDocument}#`)) return;
    event.preventDefault();
    if (url.startsWith("https://")) void shell.openExternal(url);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(here, "../dist/index.html"));
}

ipcMain.handle("document:open-markdown", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  return { name: path.basename(filePath), content: await fs.readFile(filePath, "utf8") };
});

ipcMain.handle("document:save-docx", async (_event, payload: { filename: string; bytes: Uint8Array }) => {
  const safeName = payload.filename.replace(/[^a-zA-Z0-9._ -]/g, "-").replace(/\.docx$/i, "") || "document";
  const result = await dialog.showSaveDialog({
    defaultPath: `${safeName}.docx`,
    filters: [{ name: "Microsoft Word Document", extensions: ["docx"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(payload.bytes));
  return result.filePath;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
