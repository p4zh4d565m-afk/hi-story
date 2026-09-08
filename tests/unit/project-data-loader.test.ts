import { describe, expect, it } from 'vitest';
import {
  createProjectDataLoader,
  createProjectSelectionGuard,
  type ProjectDataSnapshot,
} from '../../src/renderer/services/project-data-loader';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const channels = [
  'db:chapter:findByProject',
  'db:outline:findByProject',
  'db:character:findByProject',
  'db:worldEntry:findByProject',
  'db:referenceLink:findAllCharacterRelations',
] as const;

function createHarness() {
  const requests = new Map<string, Deferred<any>>();
  let state: ProjectDataSnapshot | null = null;
  const errors: Array<{ projectId: string; error: unknown }> = [];
  const loading: Array<{ projectId: string; value: boolean }> = [];
  const invoke = (channel: string, projectId: unknown) => {
    const request = deferred<any>();
    requests.set(`${projectId}:${channel}`, request);
    return request.promise;
  };
  const loader = createProjectDataLoader({
    invoke,
    onApply: snapshot => { state = snapshot; },
    onError: (projectId, error) => { errors.push({ projectId, error }); },
    onLoadingChange: (projectId, value) => { loading.push({ projectId, value }); },
  });

  const resolveProject = (projectId: string) => {
    const data = {
      'db:chapter:findByProject': [{ id: `${projectId}-chapter`, projectId }],
      'db:outline:findByProject': [{ id: `${projectId}-outline`, projectId }],
      'db:character:findByProject': [{ id: `${projectId}-character`, projectId }],
      'db:worldEntry:findByProject': [{ id: `${projectId}-world`, projectId }],
      'db:referenceLink:findAllCharacterRelations': [{
        id: `${projectId}-relation`, sourceId: `${projectId}-character`, targetId: `${projectId}-other`,
        relationType: '同伴', arrowDirection: 'both',
      }],
    };
    channels.forEach(channel => requests.get(`${projectId}:${channel}`)!.resolve({ success: true, data: data[channel] }));
  };

  return { loader, requests, resolveProject, errors, loading, getState: () => state, setState: (next: ProjectDataSnapshot) => { state = next; } };
}

describe('项目数据加载协调器', () => {
  it('后一次项目选择会让前一次选择代次失效', () => {
    const guard = createProjectSelectionGuard();
    const selectionA = guard.select('A');
    const selectionB = guard.select('B');

    expect(guard.isCurrent(selectionA)).toBe(false);
    expect(guard.isCurrent(selectionB)).toBe(true);
    expect(guard.currentProjectId()).toBe('B');
  });

  it('项目 A 晚于项目 B 返回时只应用项目 B 的完整状态', async () => {
    const harness = createHarness();
    const loadingA = harness.loader.load('A');
    const loadingB = harness.loader.load('B');

    harness.resolveProject('B');
    await expect(loadingB).resolves.toBe('applied');
    expect(harness.getState()).toMatchObject({
      projectId: 'B',
      chapters: [{ id: 'B-chapter', projectId: 'B' }],
      outlineNodes: [{ id: 'B-outline', projectId: 'B' }],
      characters: [{ id: 'B-character', projectId: 'B' }],
      worldEntries: [{ id: 'B-world', projectId: 'B' }],
      relations: [{ id: 'B-relation' }],
    });

    harness.resolveProject('A');
    await expect(loadingA).resolves.toBe('stale');
    expect(harness.getState()?.projectId).toBe('B');
  });

  it('选择已切到 B、但 B 的加载副作用尚未启动时也拒绝项目 A 的结果', async () => {
    const requests = new Map<string, Deferred<any>>();
    let selectedProjectId = 'A';
    let applied: ProjectDataSnapshot | null = null;
    const loader = createProjectDataLoader({
      invoke: (channel, projectId) => {
        const request = deferred<any>();
        requests.set(`${projectId}:${channel}`, request);
        return request.promise;
      },
      isProjectCurrent: projectId => projectId === selectedProjectId,
      onApply: snapshot => { applied = snapshot; },
    });

    const loadingA = loader.load('A');
    selectedProjectId = 'B';
    channels.forEach(channel => requests.get(`A:${channel}`)!.resolve({ success: true, data: [] }));

    await expect(loadingA).resolves.toBe('stale');
    expect(applied).toBeNull();
  });

  it('不会为已经失去选择权的项目启动加载', async () => {
    let invokeCount = 0;
    const loader = createProjectDataLoader({
      invoke: async () => { invokeCount += 1; return { success: true, data: [] }; },
      isProjectCurrent: projectId => projectId === 'B',
      onApply: () => undefined,
    });

    await expect(loader.load('A')).resolves.toBe('stale');
    expect(invokeCount).toBe(0);
  });

  it('旧项目请求失败不会报错、清空或污染当前项目', async () => {
    const harness = createHarness();
    const loadingA = harness.loader.load('A');
    const loadingB = harness.loader.load('B');
    harness.resolveProject('B');
    await loadingB;

    harness.requests.get('A:db:chapter:findByProject')!.reject(new Error('A 读取失败'));
    await expect(loadingA).resolves.toBe('stale');
    expect(harness.getState()?.projectId).toBe('B');
    expect(harness.errors).toEqual([]);
    expect(harness.loading.at(-1)).toEqual({ projectId: 'B', value: false });
  });

  it('当前项目加载失败时保留已经显示的完整状态', async () => {
    const harness = createHarness();
    const existing = { projectId: 'B', chapters: [], outlineNodes: [], characters: [], worldEntries: [], relations: [] } as ProjectDataSnapshot;
    harness.setState(existing);

    const loadingB = harness.loader.load('B');
    harness.requests.get('B:db:outline:findByProject')!.resolve({ success: false, error: '大纲读取失败' });
    await expect(loadingB).resolves.toBe('failed');
    expect(harness.getState()).toBe(existing);
    expect(harness.errors).toHaveLength(1);
  });
});
