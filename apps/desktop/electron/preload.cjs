const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  openMarkdown: () => ipcRenderer.invoke("document:open-markdown"),
  saveDocx: (filename, bytes) =>
    ipcRenderer.invoke("document:save-docx", { filename, bytes }),
});
