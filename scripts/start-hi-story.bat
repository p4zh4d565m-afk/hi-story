@echo off
cd /d "%~dp0..\..\.."
echo.
echo   📖  hi story - 小说写作辅助工具
echo   ==============================
echo.
echo   正在启动开发服务器...
echo.
start "" "%~dp0..\..\..\node_modules\electron\dist\electron.exe" "%~dp0..\..\.."
echo   Electron 已启动!
echo   如果浏览器没打开，请访问 http://localhost:5173
echo.
pause
