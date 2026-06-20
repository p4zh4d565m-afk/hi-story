@echo off
cd /d C:\Users\Ariel\Downloads\ccx
echo.
echo   📖 hi story - 正在启动...
echo.
call npm run electron:rebuild >nul 2>&1
start "" C:\Users\Ariel\Downloads\ccx\node_modules\electron\dist\electron.exe C:\Users\Ariel\Downloads\ccx
