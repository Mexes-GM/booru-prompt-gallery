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
