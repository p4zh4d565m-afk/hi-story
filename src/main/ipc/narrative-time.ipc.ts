/**
 * 叙事时间截面 IPC：按 taskType 固定模式折叠，渲染端不得自选任意截面。
 */
import { ipcMain } from 'electron';
import type { IpcResult } from '../../renderer/types';
import { getDb } from '../db/connection';
import { loadNarrativeAsOfFromDb, type LoadNarrativeAsOfInput } from '../ai/narrative-as-of-loader';

export type BuildAsOfContextInput = LoadNarrativeAsOfInput;

export function registerNarrativeTimeIpc(): void {
  ipcMain.handle(
    'db:narrative:buildAsOfContext',
    (_e, input: BuildAsOfContextInput): IpcResult<{
      mode: string;
      textBlock: string;
      historyWarningCount: number;
    }> => {
      try {
        const ctx = loadNarrativeAsOfFromDb(getDb(), input);
        if (ctx.historyWarnings.length > 0) {
          console.warn(
            `[narrative-as-of] project=${input.projectId} warnings=${ctx.historyWarnings.length}`,
          );
        }
        return {
          success: true,
          data: {
            mode: ctx.mode,
            textBlock: ctx.textBlock,
            historyWarningCount: ctx.historyWarnings.length,
          },
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
