-- Backblaze B2 joins LOCAL and R2 as a storage provider.
--
-- Postgres adds an enum value without a table rewrite, and existing rows keep
-- their value: adding a provider has never moved anybody's bytes.
ALTER TYPE "StorageType" ADD VALUE IF NOT EXISTS 'B2';
