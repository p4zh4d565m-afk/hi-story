const { contextBridge, ipcRenderer } = require('electron');
// 仅测试窗口加载；渲染端通过 electronAPI.invoke 调用 prepare/reparse/commit。
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke('test:obsidian-import-db', channel, ...args),
});
