@echo off
cd /d "%~dp0"
chcp 936 >nul 2>nul

where python >nul 2>nul
if not %errorlevel%==0 goto nopython

echo.
echo =========================================================
echo   BookShelf local server
echo ---------------------------------------------------------
echo   On this PC :  http://localhost:8000
echo.
echo   On your phone (same Wi-Fi), open one of these:
ipconfig | findstr /c:"IPv4"
echo   ...then add  :8000  to that address
echo ---------------------------------------------------------
echo   Keep this window open. Press Ctrl+C to stop.
echo =========================================================
echo.
start "" http://localhost:8000
python -m http.server 8000
goto :eof

:nopython
echo.
echo Python not found. Opening index.html directly...
echo Tip: to use it on a phone, install Python or upload the folder
echo      to any static host (Netlify / GitHub Pages / Vercel).
echo.
start "" index.html
