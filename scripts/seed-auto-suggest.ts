import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseServiceKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Configuration
const CHUNK_SIZE = 5000; // Optimized for better throughput (was 1000)
const CHUNK_DELAY_MS = 100; // Rate limiting between chunks
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface TagData {
  name: string;
  category: number;
}

interface ValidationResult {
  valid: boolean;
  skippedCount: number;
  validTags: TagData[];
}

/**
 * Validates and normalizes tag data
 * - Filters out invalid entries (null names, missing categories)
 * - Normalizes strings (trim, lowercase for consistency)
 * - Ensures category is a valid number
 */
function validateAndNormalizeTags(tags: any[]): ValidationResult {
  const validTags: TagData[] = [];
  let skippedCount = 0;

  for (const tag of tags) {
    // Skip if missing required fields
    if (!tag || typeof tag.name !== 'string' || tag.name.trim().length === 0) {
      skippedCount++;
      continue;
    }

    // Validate category
    const category = Number(tag.category);
    if (isNaN(category)) {
      skippedCount++;
      continue;
    }

    validTags.push({
      name: tag.name.trim().toLowerCase(),
      category: category
    });
  }

  return {
    valid: validTags.length > 0,
    skippedCount,
    validTags
  };
}

/**
 * Retry logic with exponential backoff
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = MAX_RETRIES
): Promise<{ success: boolean; data?: T; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);

      if (attempt < maxRetries) {
        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`  ⏳ Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  return { 
    success: false, 
    error: `Failed after ${maxRetries} retries` 
  };
}

/**
 * Delay between chunks to avoid rate limiting
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format bytes for readable output
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Main seeding function
 */
async function seedTags() {
  const startTime = Date.now();
  let successCount = 0;
  let failedChunks: number[] = [];
  let totalSkipped = 0;

  try {
    // Step 1: Load and validate file
    console.log('\n📂 Step 1: Loading tags-optimized.json...');
    // Try to use optimized file first, fallback to original
    let filePath = path.join(process.cwd(), 'tags-optimized.json');
    let usingOptimized = true;

    if (!fs.existsSync(filePath)) {
      console.log('   ℹ️  tags-optimized.json not found, using tags.json');
      filePath = path.join(process.cwd(), 'tags.json');
      usingOptimized = false;
    } else {
      console.log('   ✅ Using optimized data (filtered & cleaned)');
    }

    if (!fs.existsSync(filePath)) {
      console.error('❌ Error: tags.json not found');
      process.exit(1);
    }

    const fileStats = fs.statSync(filePath);
    console.log(`   ✅ File size: ${formatBytes(fileStats.size)}`);

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const rawTags = JSON.parse(fileContent);

    if (!Array.isArray(rawTags)) {
      console.error('❌ Error: tags.json must be an array');
      process.exit(1);
    }

    console.log(`   ✅ Loaded ${rawTags.length.toLocaleString()} raw tags\n`);

    // Step 2: Validate and normalize data
    console.log('✔️  Step 2: Validating and normalizing tags...');
    const validation = validateAndNormalizeTags(rawTags);

    if (!validation.valid) {
      console.error('❌ No valid tags found after validation');
      process.exit(1);
    }

    totalSkipped = validation.skippedCount;
    if (totalSkipped > 0) {
      console.log(`   ⚠️  Skipped ${totalSkipped.toLocaleString()} invalid tags`);
    }
    console.log(`   ✅ Valid tags: ${validation.validTags.length.toLocaleString()}\n`);

    // Step 3: Process chunks
    console.log('📤 Step 3: Uploading to Supabase...');
    const totalChunks = Math.ceil(validation.validTags.length / CHUNK_SIZE);
    console.log(`   Total chunks: ${totalChunks} (size: ${CHUNK_SIZE.toLocaleString()} tags/chunk)\n`);

    for (let i = 0; i < validation.validTags.length; i += CHUNK_SIZE) {
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = validation.validTags.slice(i, i + CHUNK_SIZE);
      const progress = ((i / validation.validTags.length) * 100).toFixed(1);
      const tagsInChunk = Math.min(CHUNK_SIZE, validation.validTags.length - i);

      process.stdout.write(
        `   [${progress.padStart(5)}%] Chunk ${chunkIndex.toString().padStart(totalChunks.toString().length)}/${totalChunks} ` +
        `(${i.toLocaleString()}-${Math.min(i + CHUNK_SIZE, validation.validTags.length).toLocaleString()} tags)...`
      );

      const result = await retryOperation(
        async () => {
          const res = await supabase
            .from('auto_suggest_tags')
            .upsert(chunk, { onConflict: 'name' });
          if (res.error) throw res.error;
          return res;
        },
        `Chunk ${chunkIndex}`
      );

      if (result.success) {
        console.log(' ✅');
        successCount++;
      } else {
        console.log(` ❌\n   Error: ${result.error}`);
        failedChunks.push(chunkIndex);
      }

      // Rate limiting delay (except on last chunk)
      if (i + CHUNK_SIZE < validation.validTags.length) {
        await delay(CHUNK_DELAY_MS);
      }
    }

    // Step 4: Verify results
    console.log('\n🔍 Step 4: Verifying results...');
    const { count, error: countError } = await supabase
      .from('auto_suggest_tags')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error(`❌ Could not verify: ${countError.message}`);
    } else {
      console.log(`   ✅ Total records in auto_suggest_tags: ${count?.toLocaleString()}`);

      if (count) {
        const expectedMin = validation.validTags.length * 0.95;
        if (count >= expectedMin) {
          console.log(`   ✅ Verification passed (${count} >= ${Math.floor(expectedMin)})`);
        } else {
          console.warn(`   ⚠️  Warning: Expected ~${validation.validTags.length} but got ${count}`);
        }
      }
    }

    // Final summary
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('✅ SEEDING COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Mode: ${usingOptimized ? '⚡ OPTIMIZED' : '📦 FULL'}`);
    console.log(`   Successful chunks: ${successCount}/${totalChunks}`);
    console.log(`   Failed chunks: ${failedChunks.length > 0 ? failedChunks.join(', ') : 'None'}`);
    console.log(`   Skipped tags: ${totalSkipped.toLocaleString()}`);
    console.log(`   Time elapsed: ${elapsedSec}s`);
    console.log(`   Average speed: ${((validation.validTags.length / elapsedMs) * 1000).toFixed(0)} tags/sec`);
    console.log('='.repeat(70) + '\n');

    if (failedChunks.length > 0) {
      console.warn(`⚠️  ${failedChunks.length} chunk(s) failed. Consider re-running or investigating.`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Fatal error during seeding:');
    console.error(error);
    process.exit(1);
  }
}

// Run
seedTags();
