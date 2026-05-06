
import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function runSql() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL // Standard Supabase/Vercel env
  
  if (!connectionString) {
    console.error('POSTGRES_URL is not set. Check .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Supabase SSL — set to true if your CA store trusts the cert
  })

  try {
    await client.connect()
    console.log('Connected to DB.')
    
    const sqlPath = path.join(process.cwd(), 'supabase', 'ai_logs.sql')
    console.log('Reading migration:', sqlPath)
    
    const sql = fs.readFileSync(sqlPath, 'utf-8')
    await client.query(sql)
    console.log('✅ AI Logs Table Created Successfully (if not appeared before).')

  } catch (err) {
    console.error('❌ Error applying SQL:', err)
  } finally {
    await client.end()
  }
}

runSql()
