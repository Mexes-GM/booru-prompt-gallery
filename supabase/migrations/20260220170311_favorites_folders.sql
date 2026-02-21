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
