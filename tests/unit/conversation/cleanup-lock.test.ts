import { describe, it, expect } from 'vitest';
import { createCleanupLock } from '../../../src/renderer/services/conversation-cleanup-lock';

describe('conversation-cleanup-lock（token 单飞锁）', () => {
  it('首次获锁返回 token，重复获锁失败', () => {
    const lock = createCleanupLock();
    const t1 = lock.tryAcquire();
    expect(t1).toBeTruthy();
    expect(typeof t1).toBe('string');
    expect(lock.currentToken()).toBe(t1);
    expect(lock.isHeld()).toBe(true);
    expect(lock.tryAcquire()).toBeNull();
  });

  it('切项目场景：清 UI 侧不调用 release；旧 finally 用原 token 才能解开', () => {
    const lock = createCleanupLock();
    const t1 = lock.tryAcquire();
    expect(t1).toBeTruthy();
    expect(lock.tryAcquire()).toBeNull(); // 单飞
    lock.release('wrong');
    expect(lock.isHeld()).toBe(true);
    lock.release(t1!);
    expect(lock.isHeld()).toBe(false);
    expect(lock.currentToken()).toBeNull();
  });

  it('解锁后可再次获锁，且 token 不同', () => {
    const lock = createCleanupLock();
    const t1 = lock.tryAcquire()!;
    lock.release(t1);
    const t2 = lock.tryAcquire();
    expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
  });

  it('旧请求的 finally 用过期 token 不得解开新请求持有的锁', () => {
    const lock = createCleanupLock();
    const t1 = lock.tryAcquire()!;
    lock.release(t1);
    const t2 = lock.tryAcquire()!;
    expect(lock.isHeld()).toBe(true);
    lock.release(t1);
    expect(lock.isHeld()).toBe(true);
    expect(lock.currentToken()).toBe(t2);
    lock.release(t2);
    expect(lock.isHeld()).toBe(false);
  });
});
