/**
 * Database Backup Script
 * 
 * Creates a full SQL dump of all tables, data, and schema from Supabase.
 * 
 * Usage:
 *   npx ts-node --transpile-only scripts/backup-database.ts
 * 
 * Output:
 *   backup_YYYYMMDD_HHMMSS.sql in the project root
 */

import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Allow self-signed certs for Supabase pooler connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const POSTGRES_URL = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL

if (!POSTGRES_URL) {
  console.error('ERROR: POSTGRES_URL_NON_POOLING or POSTGRES_PRISMA_URL not found in .env.local')
  process.exit(1)
}

const OUTPUT_DIR = process.cwd()
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUTPUT_FILE = path.join(OUTPUT_DIR, `backup_${TIMESTAMP}.sql`)

async function main() {
  const client = new Client({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  })

  let output = ''
  const log = (msg: string) => {
    console.log(msg)
    output += `-- ${msg}\n`
  }

  try {
    await client.connect()
    log('Connected to database')

    // Header
    const header = `-- =============================================================================
-- DATABASE BACKUP
-- Generated: ${new Date().toISOString()}
-- Database: ${process.env.POSTGRES_DATABASE || 'postgres'}
-- Host: ${process.env.POSTGRES_HOST || 'unknown'}
-- =============================================================================
-- 
-- RESTORE: psql -f ${path.basename(OUTPUT_FILE)} <connection-string>
-- 
-- =============================================================================

`
    output = header + output

    // 1. Dump schema (CREATE TABLE, indexes, constraints, etc.)
    log('Dumping schema...')
    const schemaQuery = `
      SELECT 
        'CREATE TABLE IF NOT EXISTS ' || table_schema || '.' || table_name || ' (' ||
        string_agg(
          column_name || ' ' || data_type ||
          CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||
          CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
          CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
          ', '
          ORDER BY ordinal_position
        ) || ');' AS create_stmt
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name NOT IN ('spatial_ref_sys')
      GROUP BY table_schema, table_name
      ORDER BY table_name;
    `

    // Better approach: use pg_dump-like schema via information_schema
    // Get all tables
    const { rows: tables } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)

    log(`Found ${tables.length} tables: ${tables.map(t => t.table_name).join(', ')}`)

    // Dump each table's schema and data
    for (const table of tables) {
      const tableName = table.table_name
      output += `\n-- =============================================================================\n`
      output += `-- Table: ${tableName}\n`
      output += `-- =============================================================================\n\n`

      // Get column definitions
      const { rows: columns } = await client.query(`
        SELECT column_name, data_type, character_maximum_length, is_nullable, column_default,
               udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName])

      if (columns.length === 0) continue

      // Build CREATE TABLE
      output += `CREATE TABLE IF NOT EXISTS public.${tableName} (\n`
      
      const colDefs = columns.map(col => {
        let type = col.udt_name
        if (col.character_maximum_length) {
          type = `${type}(${col.character_maximum_length})`
        }
        let def = `    ${col.column_name} ${type}`
        if (col.column_default) {
          def += ` DEFAULT ${col.column_default}`
        }
        if (col.is_nullable === 'NO') {
          def += ' NOT NULL'
        }
        return def
      })

      // Get primary keys
      const { rows: pks } = await client.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public' 
          AND tc.table_name = $1 
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position;
      `, [tableName])

      if (pks.length > 0) {
        const pkCols = pks.map(pk => pk.column_name).join(', ')
        colDefs.push(`    PRIMARY KEY (${pkCols})`)
      }

      // Get foreign keys
      const { rows: fks } = await client.query(`
        SELECT 
          kcu.column_name,
          ccu.table_schema AS foreign_table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = 'public' 
          AND tc.table_name = $1 
          AND tc.constraint_type = 'FOREIGN KEY';
      `, [tableName])

      for (const fk of fks) {
        colDefs.push(
          `    FOREIGN KEY (${fk.column_name}) REFERENCES ${fk.foreign_table_name}(${fk.foreign_column_name})`
        )
      }

      output += colDefs.join(',\n')
      output += '\n);\n\n'

      // Get indexes
      const { rows: indexes } = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname;
      `, [tableName])

      for (const idx of indexes) {
        // Skip primary key indexes (they're auto-created)
        if (idx.indexname.includes('_pkey')) continue
        output += `${idx.indexdef};\n\n`
      }

      // Dump data as INSERT statements
      const { rows: data } = await client.query(`SELECT * FROM public.${tableName}`)
      log(`  ${tableName}: ${data.length} rows`)

      if (data.length > 0) {
        output += `\n-- Data for ${tableName} (${data.length} rows)\n`
        
        for (const row of data) {
          const cols = columns.map(c => c.column_name)
          const values = cols.map(col => {
            const val = row[col]
            if (val === null || val === undefined) return 'NULL'
            if (typeof val === 'number') return val.toString()
            if (typeof val === 'boolean') return val ? 'true' : 'false'
            if (val instanceof Date) return `'${val.toISOString()}'`
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`
            return `'${String(val).replace(/'/g, "''")}'`
          })
          
          output += `INSERT INTO public.${tableName} (${cols.join(', ')}) VALUES (${values.join(', ')});\n`
        }
      }

      output += '\n'
    }

    // Dump functions
    log('Dumping functions...')
    const { rows: functions } = await client.query(`
      SELECT 
        routine_name,
        routine_type,
        data_type,
        routine_definition
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name;
    `)

    if (functions.length > 0) {
      output += `\n-- =============================================================================\n`
      output += `-- Functions (${functions.length})\n`
      output += `-- =============================================================================\n\n`
      
      for (const fn of functions) {
        output += `-- Function: ${fn.routine_name} (returns ${fn.data_type})\n`
        output += `-- Definition:\n`
        output += `-- ${fn.routine_definition?.replace(/\n/g, '\n-- ') || 'N/A'}\n\n`
      }
    }

    // Dump triggers
    log('Dumping triggers...')
    const { rows: triggers } = await client.query(`
      SELECT 
        trigger_name,
        event_manipulation,
        event_object_table,
        action_statement,
        action_timing
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY trigger_name;
    `)

    if (triggers.length > 0) {
      output += `\n-- =============================================================================\n`
      output += `-- Triggers (${triggers.length})\n`
      output += `-- =============================================================================\n\n`
      
      for (const trg of triggers) {
        output += `-- Trigger: ${trg.trigger_name} on ${trg.event_object_table}\n`
        output += `-- Timing: ${trg.action_timing}\n`
        output += `-- Event: ${trg.event_manipulation}\n`
        output += `-- Statement:\n`
        output += `-- ${trg.action_statement?.replace(/\n/g, '\n-- ') || 'N/A'}\n\n`
      }
    }

    // Footer
    output += `\n-- =============================================================================\n`
    output += `-- END OF BACKUP\n`
    output += `-- =============================================================================\n`

    // Write to file
    fs.writeFileSync(OUTPUT_FILE, output, 'utf-8')
    
    const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2)
    console.log(`\n✓ Backup saved to: ${OUTPUT_FILE}`)
    console.log(`  Size: ${fileSize} KB`)
    console.log(`  Tables: ${tables.length}`)
    console.log(`  Functions: ${functions.length}`)
    console.log(`  Triggers: ${triggers.length}`)

  } catch (error) {
    console.error('\n✗ Backup failed:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
