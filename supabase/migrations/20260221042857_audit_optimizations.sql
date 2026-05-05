-- Add index for folder_id on favorite_folder_items to optimize lookups
CREATE INDEX IF NOT EXISTS idx_favorite_folder_items_folder_id ON public.favorite_folder_items(folder_id);

-- Add constraint to limit folder name length
ALTER TABLE public.favorite_folders ADD CONSTRAINT favorite_folders_name_length_check CHECK (char_length(name) <= 50);
