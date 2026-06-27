@echo off
cd /d C:\Users\Ariel\Downloads\ccx
echo.
echo   📖 hi story - 正在启动...
echo.
:: 跳过 electron:rebuild — 若 dist 未构建，请手动运行 npm run build:main
start "" C:\Users\Ariel\Downloads\ccx\node_modules\electron\dist\electron.exe C:\Users\Ariel\Downloads\ccx
