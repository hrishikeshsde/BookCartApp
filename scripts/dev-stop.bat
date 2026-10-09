@echo off
rem Stops the development SQL Server container. Its data stays in the Docker volume for the next start.
rem The backend and frontend windows are closed by hand (Ctrl+C or close the window).
setlocal
call "%~dp0lib\dev-settings.bat"
docker stop %SQL_CONTAINER%
