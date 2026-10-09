@echo off
rem Runs the Angular dev server (https://localhost:53424). It forwards /api to the backend on https://localhost:7073.
rem First run: install the packages, and trust the ASP.NET dev certificate once with: dotnet dev-certs https --trust
setlocal
title BookCart frontend
call "%~dp0lib\dev-settings.bat"
pushd "%ROOT%\BookCart\ClientApp"

if not exist node_modules (
  echo Installing the Angular packages ^(npm ci^) ...
  call npm ci
  if errorlevel 1 goto done
)

set "ASPNETCORE_HTTPS_PORT=7073"
call npm start

:done
echo.
echo The frontend stopped.
popd
pause
