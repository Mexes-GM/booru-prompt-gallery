-- AI Audit Logs Table
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name TEXT NOT NULL,
    suggested_category TEXT NOT NULL,
    ai_prediction TEXT NOT NULL,
    confidence TEXT,
    model_used TEXT,
    action_taken TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for cache lookup
CREATE INDEX IF NOT EXISTS idx_ai_logs_tag_name ON ai_audit_logs(tag_name);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_audit_logs(created_at);

-- RLS
ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for authenticated users" ON ai_audit_logs
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for all users" ON ai_audit_logs
    FOR INSERT WITH CHECK (true);
