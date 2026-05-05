import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function runSql() {
  let connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('POSTGRES_URL is not set')
    process.exit(1)
  }

  // Force sslmode=no-verify if possible by removing sslmode param and letting config handle it
  // or explicitly setting it in the connection string if pg supports it.
  // Actually, pg client 'ssl' option overrides connection string params usually.

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected to database.')
    
    const sqlPath = path.join(process.cwd(), 'supabase', 'user_auth_tables.sql')
    if (fs.existsSync(sqlPath)) {
      console.log('Running user_auth_tables.sql...')
      const sql = fs.readFileSync(sqlPath, 'utf-8')
      await client.query(sql)
      console.log('Migration applied successfully.')
    } else {
        console.error('File not found:', sqlPath)
    }

  } catch (err) {
    console.error('Migration failed:', err)
  } finally {
    await client.end()
  }
}

runSql()
