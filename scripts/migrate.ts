import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function runMigrations() {
  // Use non-pooling URL for migrations (better for DDL)
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  })

  try {
    await client.connect()
    console.log('Connected to database.')

    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql')
    const rpcPath = path.join(process.cwd(), 'supabase', 'rpc.sql')

    if (fs.existsSync(schemaPath)) {
      console.log('Running schema.sql...')
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8')
      await client.query(schemaSql)
      console.log('schema.sql applied successfully.')
    } else {
        console.warn('supabase/schema.sql not found.')
    }

    if (fs.existsSync(rpcPath)) {
      console.log('Running rpc.sql...')
      const rpcSql = fs.readFileSync(rpcPath, 'utf-8')
      await client.query(rpcSql)
      console.log('rpc.sql applied successfully.')
    } else {
        console.warn('supabase/rpc.sql not found.')
    }

    console.log('Migrations complete.')
  } catch (err) {
    console.error('Error running migrations:', err)
  } finally {
    await client.end()
  }
}

runMigrations()
