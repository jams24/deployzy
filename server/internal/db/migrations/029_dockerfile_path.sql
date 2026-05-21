-- Allow users to specify a custom Dockerfile name (e.g. Dockerfile.bot, Dockerfile.frontend)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dockerfile_path TEXT NOT NULL DEFAULT '';
