-- Migration: Create trend_cache table for daily trending data caching
-- Run this migration in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS trend_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data JSONB NOT NULL DEFAULT '[]'::jsonb,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Index on expires_at for efficient cache validity checks
CREATE INDEX IF NOT EXISTS idx_trend_cache_expires_at ON trend_cache(expires_at);

-- RLS: Allow public reads, restrict writes to service role
ALTER TABLE trend_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read trend cache" ON trend_cache
    FOR SELECT USING (true);

-- Insert a single empty row so upsert always has a target
INSERT INTO trend_cache (data, fetched_at, expires_at)
VALUES ('[]'::jsonb, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day');
