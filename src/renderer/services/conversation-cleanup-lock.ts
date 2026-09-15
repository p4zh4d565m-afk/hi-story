export type CleanupLock = {
  /** 获锁成功返回唯一 token；已占用则 null */
  tryAcquire: () => string | null;
  /** 仅当 token 与当前持有者一致时才释放 */
  release: (token: string) => void;
  isHeld: () => boolean;
  currentToken: () => string | null;
};

export function createCleanupLock(): CleanupLock {
  let heldToken: string | null = null;

  return {
    tryAcquire() {
      if (heldToken !== null) {
        return null;
      }
      heldToken = crypto.randomUUID();
      return heldToken;
    },
    release(token: string) {
      if (heldToken === token) {
        heldToken = null;
      }
    },
    isHeld() {
      return heldToken !== null;
    },
    currentToken() {
      return heldToken;
    },
  };
}
