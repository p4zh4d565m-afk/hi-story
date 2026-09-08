import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

const api: ElectronAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    // 取消函数在 preload 内持有同一包装回调，避免依赖跨桥函数的引用身份。
    return () => { ipcRenderer.removeListener(channel, wrapped); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
