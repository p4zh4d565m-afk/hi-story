import { registerProjectIpc } from './project.ipc';
import { registerChapterIpc } from './chapter.ipc';
import { registerAIIpc } from './ai.ipc';
import { registerOutlineIpc } from './outline.ipc';
import { registerCharacterIpc, registerWorldEntryIpc, registerReferenceLinkIpc } from './entities.ipc';

export function registerAllIpc(): void {
  registerProjectIpc();
  registerChapterIpc();
  registerAIIpc();
  registerOutlineIpc();
  registerCharacterIpc();
  registerWorldEntryIpc();
  registerReferenceLinkIpc();
}
