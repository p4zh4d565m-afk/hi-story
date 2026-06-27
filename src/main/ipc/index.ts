import { registerProjectIpc } from './project.ipc';
import { registerChapterIpc } from './chapter.ipc';
import { registerAIIpc } from './ai.ipc';
import { registerOutlineIpc } from './outline.ipc';
import { registerCharacterIpc, registerWorldEntryIpc, registerReferenceLinkIpc, registerSearchIpc } from './entities.ipc';
import { registerImportIpc } from './import.ipc';
import { registerExportIpc } from './export.ipc';
import { registerCryptoIpc } from './crypto.ipc';

export function registerAllIpc(): void {
  registerProjectIpc();
  registerChapterIpc();
  registerAIIpc();
  registerOutlineIpc();
  registerCharacterIpc();
  registerWorldEntryIpc();
  registerReferenceLinkIpc();
  registerSearchIpc();
  registerImportIpc();
  registerExportIpc();
  registerCryptoIpc();
}
