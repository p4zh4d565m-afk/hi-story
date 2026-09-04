/**
 * 将写作方法库中的统一领域 Skill 发布为 hi-story 可读取的资源包。
 * 开发时默认读取相邻目录；也可通过 HI_STORY_SKILLS_SOURCE 指定来源。
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const defaultSource = path.resolve(projectRoot, '..', 'cc-write_skill 库', 'skills');
const sourceRoot = path.resolve(process.env.HI_STORY_SKILLS_SOURCE || defaultSource);
const outputRoot = path.join(projectRoot, 'resources', 'writing-skills');

function readFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const lines = match[1].split(/\r?\n/);
  const result = {};
  let currentKey = null;
  let blockLines = [];

  const flushBlock = () => {
    if (currentKey) result[currentKey] = blockLines.join('\n').trim();
    currentKey = null;
    blockLines = [];
  };

  for (const line of lines) {
    if (currentKey) {
      if (/^\s+/.test(line) || line.trim() === '') {
        blockLines.push(line.trim());
        continue;
      }
      flushBlock();
    }

    const block = line.match(/^([\w-]+):\s*\|\s*$/);
    if (block) {
      currentKey = block[1];
      continue;
    }

    const scalar = line.match(/^([\w-]+):\s*(.*)$/);
    if (scalar) result[scalar[1]] = scalar[2].trim().replace(/^['"]|['"]$/g, '');
  }
  flushBlock();
  return result;
}

if (!fs.existsSync(sourceRoot)) {
  throw new Error(`找不到写作 Skill 源目录：${sourceRoot}`);
}

fs.mkdirSync(outputRoot, { recursive: true });

const skills = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
  .map(entry => {
    const sourceFile = path.join(sourceRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(sourceFile)) return null;
    const markdown = fs.readFileSync(sourceFile, 'utf8');
    const metadata = readFrontmatter(markdown);
    const targetFile = `${entry.name}.md`;
    fs.copyFileSync(sourceFile, path.join(outputRoot, targetFile));
    return {
      id: entry.name,
      name: metadata.name || entry.name,
      description: metadata.description || '',
      tags: metadata.tags || '',
      file: targetFile,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.id.localeCompare(b.id));

const manifest = {
  schemaVersion: 1,
  source: 'cc-write_skill 库/skills',
  skillCount: skills.length,
  skills,
};

fs.writeFileSync(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`synced ${skills.length} writing skills: ${sourceRoot} -> ${outputRoot}`);
