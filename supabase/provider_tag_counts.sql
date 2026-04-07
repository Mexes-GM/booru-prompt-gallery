
CREATE TABLE IF NOT EXISTS public.provider_tag_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    tag_name VARCHAR(255) NOT NULL,
    post_count BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, tag_name)
);

ALTER TABLE public.provider_tag_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view provider tag counts" ON public.provider_tag_counts
    FOR SELECT USING (true);

