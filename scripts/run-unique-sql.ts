import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function runSql() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('POSTGRES_URL is not set')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    
    // Hardcoded for this task to run the new file
    const sqlPath = path.join(process.cwd(), 'supabase', 'unique_pending.sql')
    if (fs.existsSync(sqlPath)) {
      console.log('Running unique_pending.sql...')
      const sql = fs.readFileSync(sqlPath, 'utf-8')
      await client.query(sql)
      console.log('Applied successfully.')
    } else {
        console.error('File not found:', sqlPath)
    }

  } catch (err) {
    console.error('Error:', err)
  } finally {
    await client.end()
  }
}

runSql()
