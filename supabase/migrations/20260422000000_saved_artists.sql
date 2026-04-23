-- Save Artists feature
-- Stores per-user list of saved artist tags with optional thumbnail reference
-- Applied via MCP on 2026-04-22

CREATE TABLE IF NOT EXISTS public.saved_artists (
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  artist_tag        TEXT NOT NULL,
  thumbnail_url     TEXT,
  thumbnail_post_id BIGINT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, provider, artist_tag)
);

ALTER TABLE public.saved_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved artists"
  ON public.saved_artists FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved artists"
  ON public.saved_artists FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved artists"
  ON public.saved_artists FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved artists"
  ON public.saved_artists FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_artists_user_created
  ON public.saved_artists(user_id, created_at DESC);
