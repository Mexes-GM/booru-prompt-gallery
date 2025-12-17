
-- ... (previous content)

-- 4. Stored Procedure for Approving a Suggestion safely
CREATE OR REPLACE FUNCTION approve_tag_suggestion(suggestion_id UUID)
RETURNS VOID AS $$
DECLARE
    v_tag_id UUID;
    v_new_category VARCHAR(255);
BEGIN
    -- Get tag_id and suggested_category
    SELECT tag_id, suggested_category INTO v_tag_id, v_new_category
    FROM tag_suggestions
    WHERE id = suggestion_id;

    IF v_tag_id IS NULL THEN
        RAISE EXCEPTION 'Suggestion not found';
    END IF;

    -- Update the tag's category
    UPDATE tags
    SET category = v_new_category
    WHERE id = v_tag_id;

    -- Update the suggestion status
    UPDATE tag_suggestions
    SET status = 'approved',
        updated_at = NOW()
    WHERE id = suggestion_id;
    
    -- Optional: Reject other pending suggestions for the same tag? 
    -- For now, we leave them as pending.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
