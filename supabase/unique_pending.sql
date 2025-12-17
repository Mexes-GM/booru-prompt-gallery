-- Create a unique index on tag_id and suggested_category where status is 'pending'
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_suggestions_unique_pending 
ON tag_suggestions (tag_id, suggested_category) 
WHERE status = 'pending';
