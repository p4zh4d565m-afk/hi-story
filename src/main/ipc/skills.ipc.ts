import { ipcMain } from 'electron';
import { skillRegistry } from '../skills/skill-registry';

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:list', async () => {
    try {
      return { success: true, data: skillRegistry.list() };
    } catch (err: any) {
      return { success: false, error: err.message || '读取写作 Skill 失败' };
    }
  });

  ipcMain.handle('skills:get', async (_event, id: string) => {
    try {
      const skill = skillRegistry.get(id);
      return skill
        ? { success: true, data: skill }
        : { success: false, error: `未找到写作 Skill：${id}` };
    } catch (err: any) {
      return { success: false, error: err.message || '读取写作 Skill 失败' };
    }
  });

  ipcMain.handle('skills:route', async (_event, task: string, limit?: number) => {
    try {
      return { success: true, data: skillRegistry.route(task, limit) };
    } catch (err: any) {
      return { success: false, error: err.message || '匹配写作 Skill 失败' };
    }
  });
}
