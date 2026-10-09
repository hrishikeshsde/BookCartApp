-- B4: let an EXISTING database (one created with DBScript/BookDB.txt) join the EF Core migrations history.
--
-- Run it ONCE per existing database, BEFORE applying the migrations, and only after taking a backup:
--   1. BACKUP DATABASE [BookDB] TO DISK = N'<path>' WITH INIT;
--   2. sqlcmd -S <server> -d <database> -i DBScript/B4_adopt_migrations.sql
--   3. dotnet ef migrations script --idempotent --project BookCart -o schema.sql   (review it), then run schema.sql
--      or, from the repo root:  BOOKCART_EF_CONNECTION="<connection string>" dotnet ef database update --project BookCart
--
-- It changes no table. It only records that the "Baseline" migration (the schema BookDB.txt creates) is already in
-- place, so the migrations that follow it are the only ones applied. A NEW database does not need this script: create
-- an empty database and run the migrations, which create everything.
--
-- Idempotent: running it again does nothing.

IF OBJECT_ID(N'dbo.Book') IS NULL OR OBJECT_ID(N'dbo.UserMaster') IS NULL OR COL_LENGTH(N'dbo.UserMaster', N'PasswordHash') IS NULL
    THROW 50010, 'This does not look like a BookCart database at the B0.2 schema. Run DBScript/B0.2_password_hash.sql first (or create a new database with the migrations instead).', 1;

IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );

IF NOT EXISTS (SELECT 1 FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'20261009063216_Baseline')
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion]) VALUES (N'20261009063216_Baseline', N'10.0.12');
GO
