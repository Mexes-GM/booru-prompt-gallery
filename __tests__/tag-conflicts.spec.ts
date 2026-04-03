import { resolveTagConflicts } from "../lib/tag-conflicts.ts"

function runTests() {
  console.log("Running Tag Conflicts Stress Tests...\n")

  const tests = [
    {
      name: "1. Basic Posture Block: 'from behind' blocks ONLY facial tags (lips) and frontal anatomy (cleavage)",
      baseTags: ["1girl", "solo", "from behind", "outdoors", "sky"],
      addedTags: ["lips", "cleavage", "hyper real", "masterpiece"],
      expectedValid: ["hyper real", "masterpiece"],
      expectedBlocked: ["lips", "cleavage"]
    },
    {
      name: "2. The Exception (Indulto): 'from behind' + 'looking back' ALLOWS facial tags but NOT cleavage",
      baseTags: ["1girl", "solo", "from behind", "looking back", "outdoors"],
      addedTags: ["lips", "cleavage", "masterpiece"],
      expectedValid: ["lips", "masterpiece"],
      expectedBlocked: ["cleavage"]
    },
    {
      name: "3. Face State Block: 'closed eyes' blocks 'blue eyes'",
      baseTags: ["1girl", "solo", "closed eyes", "sleeping"],
      addedTags: ["blue eyes", "glowing eyes", "beautiful lighting"],
      expectedValid: ["beautiful lighting"],
      expectedBlocked: ["blue eyes", "glowing eyes"]
    },
    {
      name: "4. Anatomy IS NOW blocked: 'from behind' blocks 'breasts' variants to prevent model confusion",
      baseTags: ["1girl", "solo", "from behind", "standing"],
      addedTags: ["huge breasts", "small breasts", "4k"],
      expectedValid: ["4k"],
      expectedBlocked: ["huge breasts", "small breasts"]
    },
    {
      name: "5. Face State Exception: 'closed eyes' + 'winking' ALLOWS 'blue eyes'",
      baseTags: ["1girl", "solo", "closed eyes", "winking"],
      addedTags: ["blue eyes", "4k"],
      expectedValid: ["blue eyes", "4k"],
      expectedBlocked: []
    },
    {
      name: "6. Global Multi-Character Exception: 'from behind' + '2girls' ALLOWS EVERYTHING",
      baseTags: ["2girls", "from behind", "outdoors"],
      addedTags: ["lips", "cleavage", "huge breasts"],
      expectedValid: ["lips", "cleavage", "huge breasts"],
      expectedBlocked: []
    },
    {
      name: "7. Global Face Indicator Exception: 'from behind' + 'blush' ALLOWS facial tags but NOT frontal anatomy",
      baseTags: ["1girl", "solo", "from behind", "blush", "sky"],
      addedTags: ["lips", "cleavage", "nose"],
      expectedValid: ["lips", "nose"],
      expectedBlocked: ["cleavage"]
    }
  ];

  let passed = 0;

  for (const t of tests) {
    const res = resolveTagConflicts(t.baseTags, t.addedTags);
    const blockedTags = res.conflictingTags.map(c => c.tag);
    
    // Sort to avoid order issues
    const validMatch = JSON.stringify([...res.validTags].sort()) === JSON.stringify([...t.expectedValid].sort());
    const blockedMatch = JSON.stringify(blockedTags.sort()) === JSON.stringify([...t.expectedBlocked].sort());
    
    if (validMatch && blockedMatch) {
      console.log(`✅ [PASS] ${t.name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${t.name}`);
      console.error(`   Expected Valid :`, t.expectedValid);
      console.error(`   Got Valid      :`, res.validTags);
      console.error(`   Expected Block :`, t.expectedBlocked);
      console.error(`   Got Blocked    :`, blockedTags);
    }
  }

  console.log(`\nResults: ${passed} / ${tests.length} tests passed.\n`);
  if (passed !== tests.length) {
    process.exit(1);
  }
}

runTests();
