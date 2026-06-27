import { ipcMain, safeStorage } from 'electron';
import type { IpcResult } from '../../renderer/types';

export function registerCryptoIpc(): void {
  // Check if encryption is available
  ipcMain.handle('crypto:isAvailable', async (): Promise<IpcResult<boolean>> => {
    try {
      return { success: true, data: safeStorage.isEncryptionAvailable() };
    } catch (err) {
      return { success: true, data: false };
    }
  });

  // Encrypt a plaintext string → base64-encoded encrypted data
  ipcMain.handle('crypto:encrypt', async (_event, plaintext: string): Promise<IpcResult<string>> => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available on this system' };
      }
      const encrypted = safeStorage.encryptString(plaintext);
      return { success: true, data: encrypted.toString('base64') };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Decrypt a base64-encoded encrypted string → plaintext
  ipcMain.handle('crypto:decrypt', async (_event, encryptedBase64: string): Promise<IpcResult<string>> => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available on this system' };
      }
      const buffer = Buffer.from(encryptedBase64, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return { success: true, data: decrypted };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
