/**
 * 将 JSON 等资源文件从 src 复制到 dist
 * tsc 不会复制 .json 文件，需要手动搬运
 */
const fs = require('fs');
const path = require('path');

const copies = [
  ['src/main/ai/synonym-config.json', 'dist/main/main/ai/synonym-config.json'],
];

for (const [src, dest] of copies) {
  const srcPath = path.join(__dirname, '..', src);
  const destPath = path.join(__dirname, '..', dest);
  const destDir = path.dirname(destPath);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(srcPath, destPath);
  console.log(`copied: ${src} -> ${dest}`);
}
