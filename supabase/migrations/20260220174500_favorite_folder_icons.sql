-- Add icon column to favorite_folders
ALTER TABLE public.favorite_folders ADD COLUMN IF NOT EXISTS icon TEXT;
