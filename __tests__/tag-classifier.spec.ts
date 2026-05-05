
import { classifyTag, classifyTags } from "../lib/tag-classifier";

// Tiny assertion helper
function expectEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error(`Assertion failed: ${label}`, { actual, expected });
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

console.log("Starting Tag Classifier Tests...");

// Clothing Tests
{
  expectEqual(classifyTag("blue dress"), "clothing", "Classify blue dress as clothing");
  expectEqual(classifyTag("school uniform"), "clothing", "Classify school uniform as clothing");
  expectEqual(classifyTag("white shirt"), "clothing", "Classify white shirt as clothing");
  expectEqual(classifyTag("gloves"), "clothing", "Classify gloves as clothing");
  expectEqual(classifyTag("hat"), "clothing", "Classify hat as clothing");
}

// Pose Tests
{
  expectEqual(classifyTag("sitting"), "pose", "Classify sitting as pose");
  expectEqual(classifyTag("standing"), "pose", "Classify standing as pose");
  expectEqual(classifyTag("looking at viewer"), "pose", "Classify looking at viewer as pose");
  expectEqual(classifyTag("arms up"), "pose", "Classify arms up as pose");
}

// Scenery Tests
{
  expectEqual(classifyTag("indoors"), "scenery", "Classify indoors as scenery");
  expectEqual(classifyTag("blue sky"), "scenery", "Classify blue sky as scenery");
  expectEqual(classifyTag("simple background"), "scenery", "Classify simple background as scenery");
  expectEqual(classifyTag("beach"), "scenery", "Classify beach as scenery");
}

// Appearance Tests
{
  expectEqual(classifyTag("1girl"), "appearance", "Classify 1girl as appearance");
  expectEqual(classifyTag("blue hair"), "appearance", "Classify blue hair as appearance");
  expectEqual(classifyTag("green eyes"), "appearance", "Classify green eyes as appearance");
  expectEqual(classifyTag("large breasts"), "appearance", "Classify large breasts as appearance");
  // expectEqual(classifyTag("cat ears"), "appearance", "Classify cat ears as appearance"); // Might be tricky depending on keywords
}

// Multiple Tags Test
{
  const tags = [
    "1girl",
    "blue dress",
    "sitting",
    "indoors",
    "blue hair"
  ];
  
  const result = classifyTags(tags);
  
  expectEqual(result.appearance.includes("1girl"), true, "Result includes 1girl in appearance");
  expectEqual(result.appearance.includes("blue hair"), true, "Result includes blue hair in appearance");
  expectEqual(result.clothing.includes("blue dress"), true, "Result includes blue dress in clothing");
  expectEqual(result.pose.includes("sitting"), true, "Result includes sitting in pose");
  expectEqual(result.scenery.includes("indoors"), true, "Result includes indoors in scenery");
}

// Character Tag Tests
{
  const characterTags = ["hatsune_miku", "rem_(re:zero)"];
  const tags = ["hatsune miku", "rem (re:zero)", "blue dress"];
  
  const result = classifyTags(tags, {}, characterTags);
  
  expectEqual(result.appearance.includes("hatsune miku"), true, "Classify hatsune miku as appearance from known list");
  expectEqual(result.appearance.includes("rem (re:zero)"), true, "Classify rem (re:zero) as appearance from known list (un-escaped)");
  
  const tagsEscaped = ["hatsune miku", "rem \\(re:zero\\)"];
  const resultEscaped = classifyTags(tagsEscaped, {}, characterTags);
  expectEqual(resultEscaped.appearance.includes("rem \\(re:zero\\)"), true, "Classify rem \\(re:zero\\) as appearance from known list (escaped)");
}

console.log("Tag Classifier Tests Complete");

// Overrides Derivation Tests
{
  const overrides = { "weird skirt": "clothing", "funny looking": "pose" };
  expectEqual(classifyTag("blue weird skirt", overrides), "clothing", "Classify blue weird skirt as clothing via override derivation");
  expectEqual(classifyTag("very funny looking", overrides), "pose", "Classify very funny looking as pose via override derivation");
}


{
  const overrides = { "bizarre object": "scenery" };
  expectEqual(classifyTag("large bizarre object", overrides), "scenery", "Classify large bizarre object via override derivation");
}

