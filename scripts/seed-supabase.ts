
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { classifyTag } from '../lib/tag-classifier'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  console.error('Please set them in your environment or .env.local before running this script.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

interface JsonTag {
  id: number
  name: string
  category: number
  postCount: number
  aliases?: string[]
}

async function seedTags() {
  const tagsPath = path.join(process.cwd(), 'tags.json')
  
  if (!fs.existsSync(tagsPath)) {
    console.error(`Error: tags.json not found at ${tagsPath}`)
    process.exit(1)
  }

  console.log('Reading tags.json...')
  const rawData = fs.readFileSync(tagsPath, 'utf-8')
  const tags: JsonTag[] = JSON.parse(rawData)
  
  console.log(`Found ${tags.length} tags. Preparing to seed...`)

  // Filter only relevant tags to save space/time (e.g., top 10000)
  // We seed all categories found in the file since it seems to contain mostly Artists/Meta
  // In a real production scenario, you would want General tags (category 0)
  
  const generalTags = tags.filter(t => t.postCount > 1000) 
  console.log(`Filtered to ${generalTags.length} popular tags (postCount > 1000).`)
  console.log(`Filtered to ${generalTags.length} popular general tags.`)

  const batchSize = 1000
  const batches = []
  
  let currentBatch = []
  for (const tag of generalTags) {
    const category = classifyTag(tag.name)
    
    // We insert into 'tags' table
    // Table schema: id (uuid), name, category
    currentBatch.push({
      name: tag.name,
      category: category
    })

    if (currentBatch.length >= batchSize) {
      batches.push(currentBatch)
      currentBatch = []
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch)

  console.log(`Processing ${batches.length} batches...`)

  let processed = 0
  for (let i = 0; i < batches.length; i++) {
    const { error } = await supabase
      .from('tags')
      .upsert(batches[i], { onConflict: 'name', ignoreDuplicates: true }) // Avoid duplicates
    
    if (error) {
      console.error(`Error inserting batch ${i + 1}:`, error.message)
    } else {
      processed += batches[i].length
      console.log(`Batch ${i + 1}/${batches.length} done. (${processed} tags)`)
    }
  }

  console.log('Seeding complete!')
}

seedTags().catch(console.error)
