@echo off
title QQ Relation Network

cd /d "%~dp0backend"

echo Starting QQ Relation Network backend...
echo Open your browser and visit: http://127.0.0.1:5000
echo Press Ctrl+C to stop the server
echo.

python app.py

pause
