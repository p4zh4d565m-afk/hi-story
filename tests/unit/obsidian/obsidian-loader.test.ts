import { describe, expect, it } from 'vitest';
import type { ObsidianScanResult } from '../../../src/renderer/types';
import { createObsidianLoader } from '../../../src/renderer/services/obsidian-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function ready(projectId: string): ObsidianScanResult {
  return {
    status: 'ready',
    path: `D:/${projectId}`,
    warnings: [],
    documents: [{
      id: `${projectId}.md`, kind: 'character', name: projectId,
      relativePath: `人物/${projectId}.md`, content: `${projectId} 的资料`,
      frontmatter: {}, updatedAt: '2026-09-08T00:00:00.000Z',
    }],
  };
}

describe('Obsidian 项目加载隔离', () => {
  it('项目 A 晚于项目 B 返回时只应用项目 B', async () => {
    const requests = new Map<string, ReturnType<typeof deferred<any>>>();
    let state: { projectId: string; result: ObsidianScanResult } | null = null;
    const loader = createObsidianLoader({
      invoke: (_channel, projectId) => {
        const request = deferred<any>();
        requests.set(String(projectId), request);
        return request.promise;
      },
      onApply: (projectId, result) => { state = { projectId, result }; },
    });

    const loadingA = loader.load('A');
    const loadingB = loader.load('B');
    requests.get('B')!.resolve({ success: true, data: ready('B') });
    await expect(loadingB).resolves.toBe('applied');
    requests.get('A')!.resolve({ success: true, data: ready('A') });
    await expect(loadingA).resolves.toBe('stale');

    expect(state?.projectId).toBe('B');
    expect(state?.result.documents[0].name).toBe('B');
  });

  it('旧项目请求失败不会影响当前项目状态', async () => {
    const requests = new Map<string, ReturnType<typeof deferred<any>>>();
    const errors: string[] = [];
    let currentProjectId = 'A';
    let appliedProjectId = '';
    const loader = createObsidianLoader({
      invoke: (_channel, projectId) => {
        const request = deferred<any>();
        requests.set(String(projectId), request);
        return request.promise;
      },
      isProjectCurrent: projectId => projectId === currentProjectId,
      onApply: projectId => { appliedProjectId = projectId; },
      onError: (_projectId, error) => errors.push((error as Error).message),
    });

    const loadingA = loader.load('A');
    currentProjectId = 'B';
    const loadingB = loader.load('B');
    requests.get('B')!.resolve({ success: true, data: ready('B') });
    await loadingB;
    requests.get('A')!.reject(new Error('A 读取失败'));
    await expect(loadingA).resolves.toBe('stale');

    expect(appliedProjectId).toBe('B');
    expect(errors).toEqual([]);
  });
});
