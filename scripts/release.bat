@echo off
rem One-command deployment on Windows. It makes sure Docker is running, then hands over to deploy\deploy.sh, run by the
rem bash that comes with Git for Windows (the same script that deploys a Linux server).
rem   scripts\release.bat            first run asks a few questions and creates deploy\.env; later runs update the deployment
rem   scripts\release.bat /y         never asks (needs an existing deploy\.env)
rem   scripts\release.bat --pull     also fetches newer base images before building
rem Set BASH_EXE to the full path of a bash.exe if Git for Windows is installed somewhere unusual.
setlocal EnableExtensions
rem Taken before the arguments are shifted: shift also moves %0, and %~dp0 would then point somewhere else.
set "HERE=%~dp0"
for %%i in ("%HERE%..") do set "ROOT=%%~fi"
set "ROOT_FWD=%ROOT:\=/%"

set "ARGS="
set "AUTO_YES="
:nextarg
if "%~1"=="" goto argsdone
if /i "%~1"=="/y" (
  set "AUTO_YES=1"
  set "ARGS=%ARGS% -y"
) else (
  set "ARGS=%ARGS% %~1"
)
shift
goto nextarg
:argsdone

echo ===== BookCart deployment =====
call "%HERE%lib\ensure-docker.bat"
if errorlevel 1 goto fail

set "BASH="
if defined BASH_EXE if exist "%BASH_EXE%" set "BASH=%BASH_EXE%"
if not defined BASH if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo Git for Windows was not found, and it provides the bash that deploy\deploy.sh needs.
  echo Install it from https://git-scm.com/download/win and run this again, or set BASH_EXE to the path of a bash.exe.
  goto fail
)

"%BASH%" "%ROOT_FWD%/deploy/deploy.sh"%ARGS%
if errorlevel 1 goto fail
if not defined AUTO_YES pause
exit /b 0

:fail
echo.
echo ===== Deployment FAILED =====
if not defined AUTO_YES pause
exit /b 1
