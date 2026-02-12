-- Create Feedback Table
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('bug', 'feature', 'general', 'other')),
    content TEXT NOT NULL,
    contact_info TEXT, -- Optional email or discord handle
    metadata JSONB DEFAULT '{}'::jsonb, -- Stores user_agent, pathname, screen_size etc.
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Policies

-- 1. Allow anyone (anon) to insert feedback
CREATE POLICY "Public can insert feedback" ON feedback
    FOR INSERT WITH CHECK (true);

-- 2. Allow only admins/service_role to select (view) feedback
-- Assuming 'authenticated' users are admins in your context, otherwise restrict closer.
-- If you use specific admin roles in app_metadata, adjust accordingly.
-- For now, we'll allow authenticated users to view, assuming this is an admin dashboard function eventually.
CREATE POLICY "Admins can view feedback" ON feedback
    FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- 3. Allow admins to update status
CREATE POLICY "Admins can update feedback" ON feedback
    FOR UPDATE USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
