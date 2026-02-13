import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Needs service role for bypass RLS/heavy insert

if (!supabaseServiceKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedTags() {
  const filePath = path.join(process.cwd(), 'tags.json');
  
  if (!fs.existsSync(filePath)) {
    console.error('Error: tags.json not found');
    return;
  }

  console.log('Reading tags.json...');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const tags = JSON.parse(fileContent);

  console.log(`Total tags to process: ${tags.length}`);

  const CHUNK_SIZE = 1000;
  for (let i = 0; i < tags.length; i += CHUNK_SIZE) {
    const chunk = tags.slice(i, i + CHUNK_SIZE).map((tag: any) => ({
      name: tag.name,
      category: tag.category
    }));

    console.log(`Inserting chunk ${i / CHUNK_SIZE + 1} of ${Math.ceil(tags.length / CHUNK_SIZE)}...`);
    
    const { error } = await supabase
      .from('auto_suggest_tags')
      .upsert(chunk, { onConflict: 'name' });

    if (error) {
      console.error(`Error in chunk ${i}:`, error.message);
    }
  }

  console.log('Finished seeding auto_suggest_tags!');
}

seedTags();
