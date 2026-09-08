import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../src/preload';

const bridge = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { contextBridge: bridge, ipcRenderer: new EventEmitter() };
});

let api: ElectronAPI;
let emitter: EventEmitter;
beforeEach(async () => {
  vi.resetModules();
  const electron = await import('electron');
  emitter = electron.ipcRenderer;
  emitter.removeAllListeners();
  await import('../../src/preload');
  api = bridge.exposeInMainWorld.mock.lastCall![1];
});

it('只把消息参数传给回调，不暴露 Electron 事件', () => {
  const callback = vi.fn();
  api.on('menu:test', callback);
  emitter.emit('menu:test', { sender: '内部对象' }, '正文');
  expect(callback).toHaveBeenCalledWith('正文');
});

it('移除监听后不再触发旧回调，并释放监听器', () => {
  const callback = vi.fn();
  const unsubscribe = api.on('menu:test', callback);
  unsubscribe();
  unsubscribe();
  emitter.emit('menu:test', {});
  expect(callback).not.toHaveBeenCalled();
  expect(emitter.listenerCount('menu:test')).toBe(0);
});

it('重复注册按次移除，不影响其他频道和回调', () => {
  const callback = vi.fn();
  const other = vi.fn();
  const first = api.on('menu:test', callback);
  const second = api.on('menu:test', callback);
  api.on('menu:test', other);
  api.on('menu:other', callback);
  first();
  emitter.emit('menu:test', {}, '一');
  expect(callback).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(1);
  second();
  second();
  emitter.emit('menu:other', {}, '二');
  expect(callback).toHaveBeenCalledTimes(2);
});
