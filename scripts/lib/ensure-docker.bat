@echo off
rem Makes sure the Docker daemon answers; starts Docker Desktop and waits for it if not. Exit code 0 = ready.
docker info >nul 2>&1
if not errorlevel 1 exit /b 0

if not exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  echo Docker is not running and Docker Desktop was not found. Install Docker Desktop first.
  exit /b 1
)
echo Docker is not running. Starting Docker Desktop, this can take a minute ...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,40) do (
  ping -n 7 127.0.0.1 >nul
  docker info >nul 2>&1
  if not errorlevel 1 exit /b 0
)
echo Docker did not start in time.
exit /b 1
