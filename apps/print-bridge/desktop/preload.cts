import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld("dixoraBridge", {
  enroll: (input: {
    apiUrl: string;
    code: string;
    computerName: string;
  }) => ipcRenderer.invoke("bridge:enroll", input),
  hideWindow: () => ipcRenderer.invoke("bridge:hide-window"),
  refreshPrinters: () => ipcRenderer.invoke("bridge:refresh-printers"),
  status: () => ipcRenderer.invoke("bridge:status"),
});
