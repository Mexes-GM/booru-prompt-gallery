
import fs from 'fs';
import path from 'path';
import { PROVIDER_URLS } from '../lib/constants';

const OUTPUT_FILE = path.join(process.cwd(), 'tags.json');
const TAGS_TO_FETCH = 100000; // Top 100k tags for a solid database
const BATCH_SIZE = 1000; // Max limit per request usually

async function fetchTags() {
  console.log(`Starting download of top ${TAGS_TO_FETCH} tags from Danbooru...`);
  
  let allTags: any[] = [];
  let page = 1;
  const maxPages = Math.ceil(TAGS_TO_FETCH / BATCH_SIZE);

  while (page <= maxPages) {
    try {
      console.log(`Fetching page ${page}/${maxPages}...`);
      // order=count (popularity)
      const url = `${PROVIDER_URLS.DANBOORU}/tags.json?search[order]=count&limit=${BATCH_SIZE}&page=${page}`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "BooruPromptGallery/1.0"
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch page ${page}: ${response.status} ${response.statusText}`);
        break;
      }

      const tags = await response.json();
      
      if (!tags.length) {
        console.log("No more tags found.");
        break;
      }

      // Map to our schema
      const mappedTags = tags.map((tag: any) => {
        // Collect aliases if available (Danbooru API usually doesn't return full alias list in index view unless asked, 
        // strictly speaking 'search[name_matches]' etc might work, but basic json has 'words'?)
        // Actually tags.json usually returns basic info.
        // Let's check what we get.
        
        // We will construct a search text
        const aliases = []; // We might not get aliases in list view efficiently without bloating requests
        // But the 'words' field or similar might be there?
        // Let's assume name is the main thing.
        
        return {
          id: tag.id,
          name: tag.name,
          category: tag.category,
          postCount: tag.post_count,
          aliases: [], // Populate if we can, or skip for speed.
          displayName: tag.name,
          searchText: tag.name // We will search by name mostly
        };
      });

      allTags = [...allTags, ...mappedTags];
      
      // Respect rate limits slightly
      await new Promise(r => setTimeout(r, 500));
      page++;
      
    } catch (error) {
      console.error("Error fetching tags:", error);
      break;
    }
  }

  console.log(`Fetched ${allTags.length} tags. Saving to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allTags, null, 4));
  console.log("Done!");
}

fetchTags();
