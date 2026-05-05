-- Table for high-performance auto-suggestion tags
CREATE TABLE IF NOT EXISTS auto_suggest_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    category INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast searching by name
CREATE INDEX IF NOT EXISTS idx_auto_suggest_tags_name ON auto_suggest_tags(name);
CREATE INDEX IF NOT EXISTS idx_auto_suggest_tags_category ON auto_suggest_tags(category);

-- Enable RLS
ALTER TABLE auto_suggest_tags ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone
CREATE POLICY "Public auto_suggest_tags are viewable by everyone" ON auto_suggest_tags
    FOR SELECT USING (true);

-- Allow admins to manage tags
CREATE POLICY "Admins can manage auto_suggest_tags" ON auto_suggest_tags
    FOR ALL USING (auth.role() = 'authenticated');
