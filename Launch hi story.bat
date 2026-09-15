@echo off
cd /d D:\ccx
echo.
echo   📖 hi story - 正在启动...
echo.
:: 跳过 electron:rebuild — 若 dist 未构建，请手动运行 npm run build:main
:: 不要用 npm run start/dev：D:\ 上的 Node 24 会把 electron 解析错。
start "" D:\ccx\node_modules\electron\dist\electron.exe D:\ccx
