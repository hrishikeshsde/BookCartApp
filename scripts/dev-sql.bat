@echo off
rem Starts SQL Server 2022 in Docker for development (data kept in a Docker volume) and applies the EF Core migrations.
rem Safe to run again: it only starts what is not running and applies migrations that are missing.
setlocal
call "%~dp0lib\dev-settings.bat"
call "%~dp0lib\ensure-docker.bat" || exit /b 1

docker container inspect %SQL_CONTAINER% >nul 2>&1
if errorlevel 1 (
  echo Creating SQL Server container %SQL_CONTAINER% on localhost:%SQL_PORT% ...
  docker run -d --name %SQL_CONTAINER% -p 127.0.0.1:%SQL_PORT%:1433 -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=%SQL_SA_PASSWORD%" -v %SQL_VOLUME%:/var/opt/mssql --restart unless-stopped mcr.microsoft.com/mssql/server:2022-latest >nul
  if errorlevel 1 exit /b 1
) else (
  echo Starting SQL Server container %SQL_CONTAINER% ...
  docker start %SQL_CONTAINER% >nul
)

echo Waiting for SQL Server to accept connections ...
set /a tries=0
:wait
docker exec -e "SQLCMDPASSWORD=%SQL_SA_PASSWORD%" %SQL_CONTAINER% /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -Q "SELECT 1" -b >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% geq 30 (
  echo SQL Server did not become ready. See: docker logs %SQL_CONTAINER%
  exit /b 1
)
ping -n 5 127.0.0.1 >nul
goto wait

:ready
echo Applying database migrations to BookDB_Dev ...
pushd "%ROOT%"
dotnet tool restore >nul
set "BOOKCART_EF_CONNECTION=%DEV_CONN%"
dotnet ef database update --project BookCart --configuration Release
set "rc=%errorlevel%"
popd
if not "%rc%"=="0" (
  echo Migrations failed.
  exit /b 1
)
echo SQL Server is ready: 127.0.0.1,%SQL_PORT%  database BookDB_Dev  user sa
exit /b 0
