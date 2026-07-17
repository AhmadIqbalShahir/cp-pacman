@echo off
setlocal

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found. Install from https://nodejs.org and rerun this script.
    pause
    exit /b 1
)

call npm install
start "CP-Pacman Server" node server.js
timeout /t 2 >nul

set CHROME_PATH=
where chrome >nul 2>nul
if %errorlevel% equ 0 (
    set CHROME_PATH=chrome
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if defined CHROME_PATH (
    start "" %CHROME_PATH% --kiosk http://localhost:3000
) else (
    echo Chrome not found on this machine. Opening with the default browser instead.
    start http://localhost:3000
)

endlocal
