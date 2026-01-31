
const { classifyTagWithLLM } = require('../lib/llm-classifier');
// const { TagCategory } = require('../lib/tag-classifier');

// Polyfill for fetch if running on older node (though Next15 requires 18+)
// const fetch = require('node-fetch'); // If needed, but usually global in Node 18

async function runTests() {
  console.log("🚀 Starting LLM Classifier Integration Tests...");
  console.log("Using OpenRouter (Gemini Flash Lite / Exp)\n");

  const testCases = [
    // 1. Clothing (Clear positive)
    { tag: "pleated_skirt", suggested: "clothing", expectedMatch: true },
    
    // 2. Pose (Clear positive)
    { tag: "arm_behind_head", suggested: "pose", expectedMatch: true },

    // 3. Scenery (Clear positive)
    { tag: "starry_sky", suggested: "scenery", expectedMatch: true },

    // 4. Appearance (Clear positive)
    { tag: "purple_eyes", suggested: "appearance", expectedMatch: true },

    // 5. Mismatch: User says Clothing, AI should say Appearance (e.g. animal ears are body parts usually, though could be fake ears)
    // Let's use something clearer. "smile" is Pose/Appearance, definitely not Clothing.
    { tag: "smile", suggested: "clothing", expectedMatch: false },

    // 6. Mismatch: User says Scenery, AI should say Appearance
    { tag: "long_hair", suggested: "scenery", expectedMatch: false },

    // 7. NSFW Check (Critical for Booru)
    { tag: "doggystyle", suggested: "pose", expectedMatch: true },
    { tag: "sex", suggested: "pose", expectedMatch: true },
    { tag: "nipples", suggested: "appearance", expectedMatch: true },
  ];

  let passed = 0;

  for (const test of testCases) {
    console.log(`\n📋 Testing Tag: "${test.tag}" -> User Suggestion: [${test.suggested}]`);
    const start = Date.now();
    
    try {
        const result = await classifyTagWithLLM(test.tag, test.suggested);
        const duration = Date.now() - start;
        
        const isSuccess = result.match === test.expectedMatch;
        if (isSuccess) passed++;

        const icon = isSuccess ? "✅" : "❌";
        
        console.log(`${icon} Result: ${isSuccess ? "PASS" : "FAIL"} in ${duration}ms`);
        console.log(`   AI Category: ${result.aiCategory}`);
        console.log(`   Match Status: ${result.match}`);
        console.log(`   Confidence: ${result.confidence}`);
        console.log(`   Reasoning: ${result.reasoning}`);
        console.log(`   Model: ${result.usedModel}`);

    } catch (error) {
        console.error("❌ Error running test case:", error);
    }
    console.log("-------------------------------------------");
  }

  console.log(`\n🎉 Tests Completed. ${passed}/${testCases.length} Passed.`);
}

runTests().catch(e => {
    console.error("Fatal Test Error:", e);
});
