-- B0.2: store password hashes instead of plaintext.
-- Run ONCE against an existing database (a fresh database created from BookDB.txt already has these changes).
-- Back the database up first (see docs/BACKEND_IMPLEMENTATION_PLAN.md, Step 0).
-- Idempotent: safe to re-run.

IF COL_LENGTH('dbo.UserMaster', 'PasswordHash') IS NULL
    ALTER TABLE dbo.UserMaster ADD PasswordHash varchar(256) NULL;
GO

-- Legacy plaintext column: emptied row by row as each user next logs in.
ALTER TABLE dbo.UserMaster ALTER COLUMN Password varchar(40) NULL;
GO

-- Fails if two rows share a Username (compared case-insensitively). Resolve those rows by hand, then re-run:
--   SELECT Username, COUNT(*) FROM dbo.UserMaster GROUP BY Username HAVING COUNT(*) > 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UserMaster_Username' AND object_id = OBJECT_ID('dbo.UserMaster'))
    CREATE UNIQUE INDEX UX_UserMaster_Username ON dbo.UserMaster(Username);
GO
