
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  console.error('Please ensure .env.local exists and contains these keys.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const rawTags = `
Head 
 ear focus 
 tag group:ears tags 
 tag group:eyes tags 
 eyebrows 
 eyelashes 
 eyelid 
 tag group:face tags 
 forehead 
 forehead mark 
 hair 
 tag group:hair 
 tag group:hair color 
 tag group:hair styles 
 beard 
 mustache 
 nose 
 head wings 
 lips 
 nape 
 tongue 
 long tongue 
 Torso 
 Upper Torso 
 areolae 
 large areolae 
 glands of montgomery 
 armpits 
 back 
 median furrow 
 breasts 
 tag group:breasts tags 
 collarbone 
 heart 
 lungs 
 neck 
 long neck 
 nipples 
 covered nipples 
 inverted nipples 
 no nipples 
 puffy nipples 
 small nipples 
 pectorals 
 ribs 
 shoulders 
 tag group:shoulders 
 Lower Torso 
 anus 
 ass 
 tag group:ass 
 cloaca 
 dimples of venus 
 groin 
 hips 
 hip dips 
 wide hips 
 intestines 
 linea alba 
 liver 
 narrow waist 
 pubic hair 
 pussy 
 cleft of venus 
 clitoris 
 fat mons 
 labia 
 mons pubis 
 tag group:pussy 
 no pussy 
 penis 
 animal penis 
 dog penis 
 dolphin penis 
 horse penis 
 knotted penis 
 pig penis 
 snake penis 
 spiked penis 
 bulge 
 covered penis 
 erection under clothes 
 disembodied penis 
 erection 
 extra penises 
 foreskin 
 phimosis 
 flaccid 
 gigantic penis 
 huge penis 
 large penis 
 multiple penises 
 small penis 
 veiny penis 
 Tag Group:Penis 
 perineum 
 prostate 
 pseudopenis 
 stomach 
 abs 
 belly 
 navel 
 covered navel 
 obliques 
 stomach_(organ) 
 testicles 
 covered testicles 
 no testicles 
 uterus 
 cervix 
 Appendages 
 arms 
 thick arms 
 biceps 
 feet 
 bad feet 
 barefoot 
 dirty feet 
 soles 
 hands 
 palms 
 joints 
 doll joints 
 robot joints 
 knees 
 kneepits 
 legs 
 long legs 
 reverse-jointed_legs 
 slim legs 
 tail 
 tag group:tail 
 tentacles 
 thighs 
 groin tendon 
 thick thighs 
 toes 
 ninja toes 
 wings 
 tag group:wings
`

const IGNORED_HEADERS = [
  'Head', 'Torso', 'Upper Torso', 'Lower Torso', 'Appendages'
]

async function seedBodyTags() {
  const lines = rawTags.split('\n')
  const tagsToInsert = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    // Ignore tag groups
    if (trimmed.toLowerCase().startsWith('tag group')) continue
    
    // Ignore headers
    if (IGNORED_HEADERS.includes(trimmed)) continue
    
    // Process tag
    // Convert to lowercase and replace spaces with underscores
    const tagName = trimmed.toLowerCase().replace(/ /g, '_')
    
    tagsToInsert.push({
      name: tagName,
      category: 'appearance'
    })
  }

  // Remove duplicates
  const uniqueTags = Array.from(new Map(tagsToInsert.map(item => [item.name, item])).values())
  
  console.log(`Prepared ${uniqueTags.length} unique tags for insertion.`)

  // Batch insert
  const batchSize = 100
  for (let i = 0; i < uniqueTags.length; i += batchSize) {
    const batch = uniqueTags.slice(i, i + batchSize)
    const { error } = await supabase
      .from('tags')
      .upsert(batch, { onConflict: 'name', ignoreDuplicates: true })
      
    if (error) {
      console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error.message)
    } else {
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} (${Math.min(i + batchSize, uniqueTags.length)}/${uniqueTags.length})`)
    }
  }
  
  console.log('Done!')
}

seedBodyTags().catch(console.error)
