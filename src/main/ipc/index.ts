import { registerProjectIpc } from './project.ipc';
import { registerChapterIpc } from './chapter.ipc';

export function registerAllIpc(): void {
  registerProjectIpc();
  registerChapterIpc();
}
