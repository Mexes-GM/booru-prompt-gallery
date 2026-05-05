-- 1. Profiles (Privacy Fix: Only Owner or Admin can read)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;

CREATE POLICY "Profiles are viewable by owner or admin" 
ON profiles FOR SELECT 
USING (auth.uid() = id OR is_admin());

-- 2. Feedback (Admin Only Access Fix)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON feedback;
DROP POLICY IF EXISTS "Admins can view feedback" ON feedback;
DROP POLICY IF EXISTS "Admins can update feedback" ON feedback;

-- Allow ANY authenticated user to INSERT feedback
CREATE POLICY "Authenticated users can insert feedback" 
ON feedback FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Allow ONLY admins to VIEW/SELECT feedback
CREATE POLICY "Admins can view feedback" 
ON feedback FOR SELECT 
USING (is_admin());

-- Allow ONLY admins to UPDATE feedback (mark resolved)
CREATE POLICY "Admins can update feedback" 
ON feedback FOR UPDATE 
USING (is_admin());

-- 3. AI Logs (Admin Only Access Fix)
ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert ai_audit_logs" ON ai_audit_logs;
DROP POLICY IF EXISTS "Admins can view ai_audit_logs" ON ai_audit_logs;

-- Insert logic (assuming system/anon usage allowed via service role, or authenticated users triggering logs)
CREATE POLICY "Authenticated users can insert ai_audit_logs" 
ON ai_audit_logs FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- View logic: ONLY admins
CREATE POLICY "Admins can view ai_audit_logs" 
ON ai_audit_logs FOR SELECT 
USING (is_admin());

-- 4. Rate Limits (Enable RLS & Admin Only)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Drop just in case
DROP POLICY IF EXISTS "Admins can manage rate_limits" ON rate_limits;

-- Only admins/service role should touch this directly
CREATE POLICY "Admins can manage rate_limits" 
ON rate_limits FOR ALL 
USING (is_admin());

-- 5. Helper: Grant execute on is_admin to authenticated users
-- Just to be safe, though public usually has execute by default
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO service_role;
