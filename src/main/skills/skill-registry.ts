import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { routeWritingSkills } from './skill-router';

export interface WritingSkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string;
}

export interface WritingSkill extends WritingSkillSummary {
  content: string;
}

interface SkillManifest {
  schemaVersion: number;
  source: string;
  skillCount: number;
  skills: Array<WritingSkillSummary & { file: string }>;
}

function getResourceRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'writing-skills');
  }
  return path.join(app.getAppPath(), 'resources', 'writing-skills');
}

export class SkillRegistry {
  private manifest: SkillManifest | null = null;

  private loadManifest(): SkillManifest {
    if (this.manifest) return this.manifest;
    const manifestPath = path.join(getResourceRoot(), 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('写作 Skill 资源包不存在，请先运行 npm run skills:sync');
    }
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SkillManifest;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills)) {
      throw new Error('写作 Skill 资源包格式不受支持');
    }
    this.manifest = parsed;
    return parsed;
  }

  list(): WritingSkillSummary[] {
    return this.loadManifest().skills.map(({ file: _file, ...skill }) => skill);
  }

  get(id: string): WritingSkill | null {
    const item = this.loadManifest().skills.find(skill => skill.id === id);
    if (!item) return null;
    const contentPath = path.join(getResourceRoot(), item.file);
    return { ...item, content: fs.readFileSync(contentPath, 'utf8') };
  }

  route(task: string, limit = 3): WritingSkillSummary[] {
    return routeWritingSkills(this.list(), task, limit);
  }
}

export const skillRegistry = new SkillRegistry();
