@echo off
setlocal
title ACM Helper Launcher
cd /d "%~dp0"

echo ========================================
echo          ACM Helper Launcher
echo ========================================
echo.

if exist "src-tauri\target\release\my-acm-helper.exe" goto start_release

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_npm

if exist "node_modules\" goto start_app
echo [1/2] Installing dependencies for the first run...
call npm install
if errorlevel 1 goto install_failed

:start_app
echo [1/2] Dependencies are ready.
echo [2/2] Starting ACM Helper...
echo.
call npm run tauri dev
if errorlevel 1 goto start_failed
goto finished

:start_release
echo Starting the packaged ACM Helper...
echo.
start "" /wait "src-tauri\target\release\my-acm-helper.exe"
if errorlevel 1 goto release_failed
goto finished

:missing_node
echo [ERROR] Node.js was not found.
echo Install Node.js LTS from https://nodejs.org/ and try again.
goto failed

:missing_npm
echo [ERROR] npm was not found. Reinstall Node.js LTS and try again.
goto failed

:install_failed
echo.
echo [ERROR] npm install failed. Review the messages above.
goto failed

:start_failed
echo.
echo [ERROR] ACM Helper failed to start. Review the messages above.
goto failed

:release_failed
echo.
echo [ERROR] The packaged ACM Helper exited with an error.
goto failed

:finished
echo.
echo ACM Helper has stopped.
goto keep_open

:failed
echo.
echo The launcher will stay open so you can read the error.

:keep_open
echo Press any key to close this window.
pause >nul
endlocal
