import { Client } from 'pg'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function fixSchema() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('POSTGRES_URL is not set')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Supabase SSL — set to true if your CA store trusts the cert
  })

  try {
    await client.connect()
    console.log('Connected. Adding UNIQUE constraint to tags(name)...')
    
    // Add unique constraint if it doesn't exist
    // Using a safe approach: try to add it, ignore if it exists (or catch error)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'tags_name_key'
        ) THEN
          ALTER TABLE tags ADD CONSTRAINT tags_name_key UNIQUE (name);
        END IF;
      END
      $$;
    `)
    
    console.log('Constraint applied.')
  } catch (err) {
    console.error('Error:', err)
  } finally {
    await client.end()
  }
}

fixSchema()
