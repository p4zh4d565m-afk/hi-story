const { contextBridge, ipcRenderer } = require('electron');
// 仅测试窗口加载，所有数据位于独立内存数据库。
contextBridge.exposeInMainWorld('decisionTestDb', {
  invoke: (channel, ...args) => ipcRenderer.invoke('test:decision-db', channel, ...args),
});
