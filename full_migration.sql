-- 1. Create favorite_folders table
CREATE TABLE IF NOT EXISTS public.favorite_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- 2. Add Policies for favorite_folders
ALTER TABLE public.favorite_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own folders" 
  ON public.favorite_folders FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own folders" 
  ON public.favorite_folders FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own folders" 
  ON public.favorite_folders FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own folders" 
  ON public.favorite_folders FOR DELETE USING (auth.uid() = user_id);

-- 3. Modify favorites table
ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.favorite_folders(id) ON DELETE SET NULL;
-- Add icon column to favorite_folders
ALTER TABLE public.favorite_folders ADD COLUMN IF NOT EXISTS icon TEXT;
-- Phase 3: Multi-Folder Support

-- 1. Create a junction table to map a single favorite post to multiple folders
CREATE TABLE IF NOT EXISTS public.favorite_folder_items (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  post_id BIGINT NOT NULL,
  folder_id UUID NOT NULL REFERENCES public.favorite_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, provider, post_id, folder_id),
  -- A post must correspond to an existing favorite record
  FOREIGN KEY (user_id, provider, post_id) REFERENCES public.favorites (user_id, provider, post_id) ON DELETE CASCADE
);

-- 2. Add RLS Policies for the new table
ALTER TABLE public.favorite_folder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own folder items" 
  ON public.favorite_folder_items FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own folder items" 
  ON public.favorite_folder_items FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own folder items" 
  ON public.favorite_folder_items FOR DELETE USING (auth.uid() = user_id);

-- 3. Data Migration: Move existing folder_ids from favorites into the new junction table
INSERT INTO public.favorite_folder_items (user_id, provider, post_id, folder_id)
SELECT user_id, provider, post_id, folder_id
FROM public.favorites
WHERE folder_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4. Clean up the old schema (optional but recommended for a clean normalized structure)
-- Note: It is safe to drop the column now since we've migrated the data.
ALTER TABLE public.favorites DROP COLUMN IF EXISTS folder_id;
-- Add index for folder_id on favorite_folder_items to optimize lookups
CREATE INDEX IF NOT EXISTS idx_favorite_folder_items_folder_id ON public.favorite_folder_items(folder_id);

-- Add constraint to limit folder name length
ALTER TABLE public.favorite_folders ADD CONSTRAINT favorite_folders_name_length_check CHECK (char_length(name) <= 50);
