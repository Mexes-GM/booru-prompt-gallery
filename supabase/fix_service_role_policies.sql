-- =============================================================================
-- MIGRATION: Fix Teach Modal Submission Infrastructure
-- Run this once in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create rate_limits table (missing — caused "System is busy" error)
-- -----------------------------------------------------------------------------
-- The existing rate_limits table has an incompatible schema (uses "key" as PK).
-- Drop and recreate cleanly — no important data is lost (these are just rate limit logs).
DROP TABLE IF EXISTS rate_limits CASCADE;

CREATE TABLE rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip VARCHAR(45) NOT NULL,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_action ON rate_limits(ip, action);
CREATE INDEX IF NOT EXISTS idx_rate_limits_created_at ON rate_limits(created_at);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Cleanup old entries (call periodically or via cron)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Create get_ip_reputation RPC (missing — caused rate limit to error out)
-- -----------------------------------------------------------------------------

-- Requires user_ip column on tag_suggestions first
ALTER TABLE tag_suggestions ADD COLUMN IF NOT EXISTS user_ip VARCHAR(45);
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_user_ip ON tag_suggestions(user_ip);

CREATE OR REPLACE FUNCTION get_ip_reputation(check_ip TEXT)
RETURNS TABLE (
    approved_count BIGINT,
    rejected_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected_count
    FROM tag_suggestions
    WHERE user_ip = check_ip;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3. Service role policies (so supabaseAdmin can INSERT/SELECT rate_limits)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can manage rate_limits" ON rate_limits;
CREATE POLICY "Service role can manage rate_limits"
ON rate_limits FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. AI auto-approve: service_role needs UPDATE on tag_suggestions and tags
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can select suggestions" ON tag_suggestions;
CREATE POLICY "Service role can select suggestions"
ON tag_suggestions FOR SELECT
TO service_role
USING (true);

DROP POLICY IF EXISTS "Service role can update suggestions" ON tag_suggestions;
CREATE POLICY "Service role can update suggestions"
ON tag_suggestions FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update tags" ON tags;
CREATE POLICY "Service role can update tags"
ON tags FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 5. Fix approve_tag_suggestion RPC (DB has stale version with is_admin() check)
--    The version in production was failing: "Access Denied: User is not an admin"
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_tag_suggestion(suggestion_id UUID)
RETURNS VOID AS $$
DECLARE
    v_tag_id UUID;
    v_new_category VARCHAR(255);
BEGIN
    SELECT tag_id, suggested_category INTO v_tag_id, v_new_category
    FROM tag_suggestions
    WHERE id = suggestion_id;

    IF v_tag_id IS NULL THEN
        RAISE EXCEPTION 'Suggestion not found';
    END IF;

    UPDATE tags
    SET category = v_new_category
    WHERE id = v_tag_id;

    UPDATE tag_suggestions
    SET status = 'approved',
        updated_at = NOW()
    WHERE id = suggestion_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 6. Grant execute on RPCs to service_role
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION approve_tag_suggestion(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION approve_tag_suggestion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ip_reputation(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_rate_limits() TO service_role;
