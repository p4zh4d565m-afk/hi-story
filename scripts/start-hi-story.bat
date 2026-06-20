@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo   📖  hi story - 小说写作辅助工具
echo.
echo   正在启动...
echo.

:: Start Electron directly (production mode)
start "" "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0.."

echo   ✅ hi story 已启动!
echo.
timeout /t 2 /nobreak >nul
