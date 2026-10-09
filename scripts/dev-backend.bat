@echo off
rem Runs the API (https://localhost:7073) against the development SQL Server container (start it with dev-sql.bat).
rem SpaProxy is not used here: the Angular dev server runs in its own window (dev-frontend.bat).
setlocal
title BookCart backend
call "%~dp0lib\dev-settings.bat"
pushd "%ROOT%\BookCart"

rem The token signing key is a development user-secret. Create one the first time.
dotnet user-secrets list 2>nul | findstr /b /c:"Jwt:SecretKey" >nul
if errorlevel 1 (
  echo Creating a development Jwt:SecretKey in user-secrets ...
  for /f %%k in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\new-secret.ps1" 32') do dotnet user-secrets set "Jwt:SecretKey" "%%k" >nul
)

set "ASPNETCORE_ENVIRONMENT=Development"
set "ASPNETCORE_URLS=https://localhost:7073;http://localhost:5073"
rem An environment variable overrides the connection string in user-secrets, which may still point at LocalDB.
set "ConnectionStrings__DefaultConnection=%DEV_CONN%"
dotnet run --no-launch-profile
echo.
echo The backend stopped (exit code %errorlevel%).
popd
pause
