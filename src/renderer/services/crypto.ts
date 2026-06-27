const ENCRYPTION_PREFIX = '🔐';

/**
 * Encrypts a plaintext string via the main process (OS-level safeStorage).
 * Returns a prefixed base64 string, or the original string if encryption is unavailable.
 */
async function encrypt(plaintext: string): Promise<string> {
  try {
    const res = await window.electronAPI.invoke('crypto:encrypt', plaintext) as any;
    if (res.success && res.data) {
      return ENCRYPTION_PREFIX + res.data;
    }
    // Fallback: store as-is with a warning prefix
    console.warn('Encryption not available, storing API key in plaintext');
    return plaintext;
  } catch {
    return plaintext;
  }
}

/**
 * Decrypts an encrypted string (with prefix) or returns the original plaintext.
 */
async function decrypt(stored: string): Promise<string> {
  if (!stored.startsWith(ENCRYPTION_PREFIX)) {
    // Legacy: plaintext storage, return as-is
    return stored;
  }
  try {
    const encryptedBase64 = stored.slice(ENCRYPTION_PREFIX.length);
    const res = await window.electronAPI.invoke('crypto:decrypt', encryptedBase64) as any;
    if (res.success && res.data) {
      return res.data as string;
    }
    // Decryption failed — might be from a different OS user session
    console.warn('Failed to decrypt stored API key — key may be from a different session');
    return ''; // Return empty string to indicate decryption failure; caller should re-prompt for key
  } catch {
    return stored; // Return as-is on error
  }
}

/**
 * Encrypt all apiKey fields in an array of configs.
 */
export async function encryptConfigs(configs: Array<{ apiKey: string; [key: string]: any }>): Promise<any[]> {
  const result = [];
  for (const c of configs) {
    result.push({
      ...c,
      apiKey: c.apiKey && !c.apiKey.startsWith(ENCRYPTION_PREFIX)
        ? await encrypt(c.apiKey)
        : c.apiKey,
    });
  }
  return result;
}

/**
 * Decrypt all apiKey fields in an array of configs.
 */
export async function decryptConfigs(configs: Array<{ apiKey: string; [key: string]: any }>): Promise<any[]> {
  const result = [];
  for (const c of configs) {
    result.push({
      ...c,
      apiKey: await decrypt(c.apiKey),
    });
  }
  return result;
}

export { encrypt, decrypt };
