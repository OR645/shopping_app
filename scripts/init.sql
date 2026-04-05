-- Run once on first DB initialization (docker-entrypoint-initdb.d)

-- Enable trigram extension for Hebrew fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable UUID generation (used as fallback)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Performance: set timezone
SET timezone = 'Asia/Jerusalem';

-- NOTE: Tables are created by SQLAlchemy on app startup (Base.metadata.create_all).
-- This script only handles extensions and global settings.

-- Verify extensions
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'uuid-ossp');
