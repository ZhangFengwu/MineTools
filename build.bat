@echo off
call npm run build
echo.
echo Load build/ directory in chrome://extensions/ (Developer mode)
pause
