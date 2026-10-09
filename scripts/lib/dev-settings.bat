@echo off
rem Shared settings for the development scripts. Call this first. The SQL password is for the local dev container only.
for %%i in ("%~dp0..\..") do set "ROOT=%%~fi"
set "SQL_CONTAINER=bookcart-dev-sql"
set "SQL_VOLUME=bookcart-dev-sqldata"
set "SQL_PORT=14330"
set "SQL_SA_PASSWORD=BookCart_Dev_Pw1x"
set "DEV_CONN=Server=127.0.0.1,%SQL_PORT%;Database=BookDB_Dev;User Id=sa;Password=%SQL_SA_PASSWORD%;TrustServerCertificate=True"
