// 独立隐藏窗口运行 Obsidian 导入真实回归，只使用内存 IPC + 临时目录，不接触用户数据库。
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-story-obsidian-import-test-'));
  require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, 'obsidian-import.tsx')],
    bundle: true,
    outfile: path.join(dir, 'fixture.js'),
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><div id="root"></div><script defer src="fixture.js"></script>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename, dir], {
    env, windowsHide: true, stdio: 'inherit',
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  require('./obsidian-import-test-db.cjs')(ipcMain);
  const dir = process.argv[2];
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(dir, 'user-data'));
  const timeout = setTimeout(() => { console.error('Obsidian 导入回归测试超时'); app.exit(1); }, 40000);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false,
        preload: path.join(__dirname, 'obsidian-import-test-preload.cjs') },
    });
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      const results = await win.webContents.executeJavaScript('window.runObsidianImportRegression()');
      for (const result of results) {
        console.log(`${result.error ? '失败' : '通过'}：${result.name}${result.error ? ' — ' + result.error : ''}`);
      }
      const failures = results.filter(result => result.error).length;
      console.log(`Obsidian 导入回归：${results.length - failures}/${results.length} 通过`);
      clearTimeout(timeout);
      app.exit(failures ? 1 : 0);
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
}
