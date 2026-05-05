
-- AI Audit Logs Table
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name TEXT NOT NULL,
    suggested_category TEXT NOT NULL,
    ai_prediction TEXT NOT NULL,
    confidence TEXT,
    model_used TEXT,
    action_taken TEXT NOT NULL, -- 'auto_approved', 'queued_for_review'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view logs
CREATE POLICY "Admins can view ai logs" ON ai_audit_logs
    FOR SELECT USING (auth.role() = 'authenticated');
