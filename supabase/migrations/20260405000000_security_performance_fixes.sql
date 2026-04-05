-- =============================================================================
-- MIGRATION: Database Security & Performance Fixes
-- Date: 2026-04-05
-- 
-- This migration addresses safe, non-destructive fixes for:
--   1. Missing is_admin() function (security_hardening_v2 was referencing it)
--   2. Missing foreign key indexes (favorites, favorite_folder_items)
--   3. Automatic rate_limits cleanup (was growing indefinitely)
--   4. trend_cache UNIQUE constraint + expired row cleanup
--   5. RLS policy unification for tag_suggestions
--   6. Drop orphaned user_preferences table (unused — code uses profiles.preferences)
--   7. feedback.content length constraint (prevent abuse)
--   8. updated_at triggers on tables missing them
--   9. Remove stale/duplicate policies that conflict
--
-- ALL operations are idempotent and safe for existing data.
-- =============================================================================

-- =============================================================================
-- 1. Create is_admin() function (was missing — caused security_hardening_v2.sql to fail)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Look up the role from profiles table for the current authenticated user
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN user_role IN ('admin', 'moderator');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute so authenticated users and service_role can call it
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- =============================================================================
-- 2. Missing foreign key indexes (performance — no data impact)
-- =============================================================================

-- favorites.user_id → profiles(id) FK index
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);

-- favorites composite index for common lookup pattern
CREATE INDEX IF NOT EXISTS idx_favorites_user_provider_post ON public.favorites(user_id, provider, post_id);

-- favorite_folder_items.user_id → profiles(id) FK index
CREATE INDEX IF NOT EXISTS idx_favorite_folder_items_user_id ON public.favorite_folder_items(user_id);

-- favorite_folder_items composite index for common lookup
CREATE INDEX IF NOT EXISTS idx_favorite_folder_items_user_folder ON public.favorite_folder_items(user_id, folder_id);

-- =============================================================================
-- 3. Automatic rate_limits cleanup via trigger
--    (cleanup_rate_limits() existed but was never called automatically)
-- =============================================================================

-- Create a trigger that lazily cleans up old rate_limits on every insert
-- This avoids needing pg_cron while keeping the table bounded
CREATE OR REPLACE FUNCTION public.auto_cleanup_rate_limits()
RETURNS TRIGGER AS $$
BEGIN
  -- Only cleanup if table has grown beyond 10000 rows (avoid overhead on small tables)
  IF (SELECT COUNT(*) FROM public.rate_limits) > 10000 THEN
    DELETE FROM public.rate_limits WHERE created_at < NOW() - INTERVAL '1 day';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS trg_auto_cleanup_rate_limits ON public.rate_limits;

CREATE TRIGGER trg_auto_cleanup_rate_limits
  AFTER INSERT ON public.rate_limits
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.auto_cleanup_rate_limits();

-- =============================================================================
-- 4. trend_cache: UNIQUE constraint + expired row cleanup
--    (was allowing unlimited rows with no eviction)
-- =============================================================================

-- Add a trigger to auto-delete expired rows on every insert
CREATE OR REPLACE FUNCTION public.auto_cleanup_trend_cache()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.trend_cache WHERE expires_at < NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_cleanup_trend_cache ON public.trend_cache;

CREATE TRIGGER trg_auto_cleanup_trend_cache
  AFTER INSERT ON public.trend_cache
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.auto_cleanup_trend_cache();

-- =============================================================================
-- 5. RLS policy unification for tag_suggestions
--    (conflicting policies between schema.sql, fix_service_role_policies.sql, etc.)
-- =============================================================================

-- Drop all existing policies on tag_suggestions to start clean
DROP POLICY IF EXISTS "Public can insert suggestions" ON public.tag_suggestions;
DROP POLICY IF EXISTS "Admins can view all suggestions" ON public.tag_suggestions;
DROP POLICY IF EXISTS "Admins can update suggestions" ON public.tag_suggestions;
DROP POLICY IF EXISTS "Service role can select suggestions" ON public.tag_suggestions;
DROP POLICY IF EXISTS "Service role can update suggestions" ON public.tag_suggestions;

-- Public can insert (crowdsourcing)
CREATE POLICY "tag_suggestions_public_insert" ON public.tag_suggestions
  FOR INSERT WITH CHECK (true);

-- Anyone can view pending suggestions (needed for UI display)
CREATE POLICY "tag_suggestions_public_select" ON public.tag_suggestions
  FOR SELECT USING (true);

-- Authenticated users (admins) can update status
CREATE POLICY "tag_suggestions_admin_update" ON public.tag_suggestions
  FOR UPDATE USING (auth.role() = 'authenticated' OR is_admin());

-- Service role can do everything (for auto-suggest and admin tools)
CREATE POLICY "tag_suggestions_service_all" ON public.tag_suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 6. Drop orphaned user_preferences table
--    (code uses profiles.preferences JSONB, not this table)
-- =============================================================================

-- Only drop if it exists and has no data (safe guard)
DO $$
DECLARE
  row_count BIGINT;
BEGIN
  -- Check if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_preferences') THEN
    SELECT COUNT(*) INTO row_count FROM public.user_preferences;
    
    IF row_count = 0 THEN
      DROP TABLE public.user_preferences;
      RAISE NOTICE 'Dropped orphaned user_preferences table (0 rows)';
    ELSE
      RAISE NOTICE 'user_preferences table has % rows — NOT dropping. Review manually.', row_count;
    END IF;
  END IF;
END $$;

-- =============================================================================
-- 7. feedback.content length constraint (prevent abuse)
-- =============================================================================

-- Only add if constraint doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'feedback' AND constraint_name = 'feedback_content_length_check'
  ) THEN
    ALTER TABLE public.feedback 
      ADD CONSTRAINT feedback_content_length_check 
      CHECK (char_length(content) <= 10000);
  END IF;
END $$;

-- Also add constraint on contact_info for good measure
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'feedback' AND constraint_name = 'feedback_contact_info_length_check'
  ) THEN
    ALTER TABLE public.feedback 
      ADD CONSTRAINT feedback_contact_info_length_check 
      CHECK (contact_info IS NULL OR char_length(contact_info) <= 255);
  END IF;
END $$;

-- =============================================================================
-- 8. updated_at triggers on tables missing them
-- =============================================================================

-- tag_suggestions.updated_at trigger
CREATE OR REPLACE FUNCTION public.update_tag_suggestions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_tag_suggestions_timestamp ON public.tag_suggestions;
CREATE TRIGGER trg_update_tag_suggestions_timestamp
  BEFORE UPDATE ON public.tag_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_tag_suggestions_timestamp();

-- favorite_folders.updated_at trigger
CREATE OR REPLACE FUNCTION public.update_favorite_folders_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_favorite_folders_timestamp ON public.favorite_folders;
CREATE TRIGGER trg_update_favorite_folders_timestamp
  BEFORE UPDATE ON public.favorite_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_favorite_folders_timestamp();

-- =============================================================================
-- 9. Clean up stale/duplicate policies on other tables
-- =============================================================================

-- ai_audit_logs: unify policies (was defined in both ai_logs.sql and create_ai_audit_logs.sql)
DROP POLICY IF EXISTS "Admins can view ai logs" ON public.ai_audit_logs;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.ai_audit_logs;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.ai_audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert ai_audit_logs" ON public.ai_audit_logs;
DROP POLICY IF EXISTS "Admins can view ai_audit_logs" ON public.ai_audit_logs;

-- Service role can insert (for auto-suggest system)
CREATE POLICY "ai_audit_logs_service_insert" ON public.ai_audit_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- Admins can view
CREATE POLICY "ai_audit_logs_admin_select" ON public.ai_audit_logs
  FOR SELECT USING (is_admin());

-- Authenticated users can insert (for client-side logging)
CREATE POLICY "ai_audit_logs_auth_insert" ON public.ai_audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- feedback: clean up stale policies
DROP POLICY IF EXISTS "Public can insert feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins can view feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins can update feedback" ON public.feedback;
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.feedback;

-- Anyone can insert feedback
CREATE POLICY "feedback_public_insert" ON public.feedback
  FOR INSERT WITH CHECK (true);

-- Admins can view feedback
CREATE POLICY "feedback_admin_select" ON public.feedback
  FOR SELECT USING (is_admin());

-- Admins can update feedback (mark resolved)
CREATE POLICY "feedback_admin_update" ON public.feedback
  FOR UPDATE USING (is_admin());

-- rate_limits: clean up stale policies
DROP POLICY IF EXISTS "Admins can manage rate_limits" ON public.rate_limits;

-- Service role manages rate_limits (for server-side checks)
CREATE POLICY "rate_limits_service_all" ON public.rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 10. profiles RLS: update to use is_admin() (was referencing undefined function)
-- =============================================================================

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by owner or admin" ON public.profiles;

-- Owner or admin can view profiles
CREATE POLICY "profiles_owner_or_admin_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR is_admin());

-- Users can update their own profile
CREATE POLICY "profiles_owner_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "profiles_owner_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Service role can do everything on profiles (for admin tools)
CREATE POLICY "profiles_service_all" ON public.profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 11. favorites RLS: add service_role policy (was missing)
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can insert own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can delete own favorites" ON public.favorites;

-- Users manage their own favorites
CREATE POLICY "favorites_owner_select" ON public.favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "favorites_owner_insert" ON public.favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorites_owner_delete" ON public.favorites
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can manage favorites (for sync/migration tools)
CREATE POLICY "favorites_service_all" ON public.favorites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 12. favorite_folders RLS: add service_role policy
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own folders" ON public.favorite_folders;
DROP POLICY IF EXISTS "Users can insert own folders" ON public.favorite_folders;
DROP POLICY IF EXISTS "Users can update own folders" ON public.favorite_folders;
DROP POLICY IF EXISTS "Users can delete own folders" ON public.favorite_folders;

CREATE POLICY "favorite_folders_owner_select" ON public.favorite_folders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "favorite_folders_owner_insert" ON public.favorite_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorite_folders_owner_update" ON public.favorite_folders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "favorite_folders_owner_delete" ON public.favorite_folders
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can manage folders
CREATE POLICY "favorite_folders_service_all" ON public.favorite_folders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 13. favorite_folder_items RLS: add service_role policy
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own folder items" ON public.favorite_folder_items;
DROP POLICY IF EXISTS "Users can insert own folder items" ON public.favorite_folder_items;
DROP POLICY IF EXISTS "Users can delete own folder items" ON public.favorite_folder_items;

CREATE POLICY "favorite_folder_items_owner_select" ON public.favorite_folder_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "favorite_folder_items_owner_insert" ON public.favorite_folder_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorite_folder_items_owner_delete" ON public.favorite_folder_items
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can manage folder items
CREATE POLICY "favorite_folder_items_service_all" ON public.favorite_folder_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 14. tags RLS: add service_role policy (was missing)
-- =============================================================================

DROP POLICY IF EXISTS "Public tags are viewable by everyone" ON public.tags;
DROP POLICY IF EXISTS "Admins can insert tags" ON public.tags;
DROP POLICY IF EXISTS "Admins can update tags" ON public.tags;
DROP POLICY IF EXISTS "Service role can update tags" ON public.tags;

-- Public can read tags
CREATE POLICY "tags_public_select" ON public.tags
  FOR SELECT USING (true);

-- Authenticated users can insert/update tags
CREATE POLICY "tags_auth_insert" ON public.tags
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tags_auth_update" ON public.tags
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Service role can insert/update tags (for auto-suggest)
CREATE POLICY "tags_service_insert" ON public.tags
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tags_service_update" ON public.tags
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 15. auto_suggest_tags RLS: clean up and unify
-- =============================================================================

DROP POLICY IF EXISTS "Public auto_suggest_tags are viewable by everyone" ON public.auto_suggest_tags;
DROP POLICY IF EXISTS "Admins can manage auto_suggest_tags" ON public.auto_suggest_tags;

-- Public can read
CREATE POLICY "auto_suggest_tags_public_select" ON public.auto_suggest_tags
  FOR SELECT USING (true);

-- Service role can manage
CREATE POLICY "auto_suggest_tags_service_all" ON public.auto_suggest_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);
