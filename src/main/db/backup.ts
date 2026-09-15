/**
 * 启动自动备份
 * 每次启动在迁移前，用 better-sqlite3 的在线备份 API 把真实小说库复制一份到
 * userData/backups/，只保留最近 MAX_BACKUPS 份，旧的自动删除。
 * 备份失败不阻断启动（只记录日志），避免因磁盘满/权限问题导致应用打不开。
 *
 * 迁移前备份的意义：迁移是唯一的自动结构变更，是最大的数据丢失风险点——若迁移中途
 * 失败，迁移前的这份备份是唯一能完整恢复的原始数据。故 index.ts 在 runMigrations 之前
 * 同步 await 本函数。
 *
 * 注意：「首次启动无库跳过」由调用方 index.ts 在 getDb() 之前用 isFirstRun 判断，
 * 本函数不再判断 existsSync——等跑到这里时 getDb() 已建库。
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getDb } from './connection';

/** 保留的最近备份份数 */
const MAX_BACKUPS = 5;

/** 首启判断：库文件尚不存在即为首次启动（getDb() 会当场建库，须在建库前判断） */
export function isFirstRun(dbPath: string): boolean {
  return !fs.existsSync(dbPath);
}

function getBackupsDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

/** 删除超出保留数量的旧备份（按文件名时间戳字典序 = 时间序） */
function pruneBackups(dir: string): void {
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('hi-story-backup-') && f.endsWith('.db'))
    .sort(); // ISO 时间戳字典序即时间序

  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift()!;
    try {
      fs.unlinkSync(path.join(dir, oldest));
    } catch { /* 删除失败忽略，下次启动再清 */ }
  }
}

export async function backupOnStartup(): Promise<void> {
  try {
    const backupsDir = getBackupsDir();
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const db = getDb();
    // 文件名带毫秒，避免同一秒内两次启动（或时间戳精度不足）导致备份互相覆盖
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', `-${Date.now() % 1000}`);
    const destPath = path.join(backupsDir, `hi-story-backup-${ts}.db`);

    // 在线一致性备份：SQLite 备份 API 做快照，无需手动 checkpoint，也不会影响正在进行的写
    await db.backup(destPath);

    pruneBackups(backupsDir);
    console.log(`[Backup] 已自动备份数据库 → ${destPath}`);
  } catch (err) {
    console.error('[Backup] 自动备份失败（不阻断启动）:', err);
  }
}
