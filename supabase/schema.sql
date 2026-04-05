-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Main tags table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Category suggestions table
CREATE TABLE IF NOT EXISTS tag_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    current_category VARCHAR(255) NOT NULL,
    suggested_category VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_status ON tag_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_tag_id ON tag_suggestions(tag_id);

-- 3. RLS Policies (Row Level Security) - Basic Setup
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_suggestions ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone for tags
CREATE POLICY "Public tags are viewable by everyone" ON tags
    FOR SELECT USING (true);

-- Allow authenticated users with admin role to insert/update tags
CREATE POLICY "Admins can insert tags" ON tags
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can update tags" ON tags
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

-- Suggestions: Allow public to insert (crowdsourcing), but only admins to view/update status
CREATE POLICY "Public can insert suggestions" ON tag_suggestions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view all suggestions" ON tag_suggestions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can update suggestions" ON tag_suggestions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

-- Favorites Folders (added via AI)
CREATE TABLE IF NOT EXISTS public.favorite_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.favorite_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own folders" ON public.favorite_folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own folders" ON public.favorite_folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own folders" ON public.favorite_folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own folders" ON public.favorite_folders FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.favorite_folders(id) ON DELETE SET NULL;
