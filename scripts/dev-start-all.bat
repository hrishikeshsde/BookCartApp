@echo off
rem One click for development: SQL Server (Docker) + migrations, then the backend and the frontend, each in its own window.
setlocal
call "%~dp0dev-sql.bat"
if errorlevel 1 (
  echo.
  echo Could not start SQL Server. Nothing else was started.
  pause
  exit /b 1
)

start "BookCart backend" cmd /k call "%~dp0dev-backend.bat"
start "BookCart frontend" cmd /k call "%~dp0dev-frontend.bat"

echo.
echo Backend and frontend are starting in their own windows.
echo When the frontend window says it is ready, open https://localhost:53424
echo API reference: https://localhost:7073/scalar/v1
echo Stop everything with scripts\dev-stop.bat and by closing the two windows.
ping -n 9 127.0.0.1 >nul
