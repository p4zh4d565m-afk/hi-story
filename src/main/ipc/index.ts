import { registerProjectIpc } from './project.ipc';
import { registerChapterIpc } from './chapter.ipc';
import { registerAIIpc } from './ai.ipc';
import { registerOutlineIpc } from './outline.ipc';

export function registerAllIpc(): void {
  registerProjectIpc();
  registerChapterIpc();
  registerAIIpc();
  registerOutlineIpc();
}
