-- Add user_ip column to tag_suggestions for reputation tracking
ALTER TABLE tag_suggestions ADD COLUMN IF NOT EXISTS user_ip VARCHAR(45);

-- Index for fast lookup of suggestions by IP
CREATE INDEX IF NOT EXISTS idx_tag_suggestions_user_ip ON tag_suggestions(user_ip);

-- Function to get user reputation stats
-- Returns: accepted_count, rejected_count
CREATE OR REPLACE FUNCTION get_ip_reputation(check_ip TEXT)
RETURNS TABLE (
    approved_count BIGINT,
    rejected_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count
    FROM tag_suggestions
    WHERE user_ip = check_ip;
END;
$$ LANGUAGE plpgsql;
