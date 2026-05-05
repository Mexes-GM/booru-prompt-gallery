import { strict as assert } from "assert"
import { 
  analyzeBackground, 
  processBackgroundTags, 
  isBackgroundTag 
} from "../lib/background-detector"

console.log("Running Background Detector specs...");

// Test isBackgroundTag
  assert.equal(isBackgroundTag("simple background"), true);
  assert.equal(isBackgroundTag("white background"), true);
  assert.equal(isBackgroundTag("indoors"), true);
  assert.equal(isBackgroundTag("scenery"), true);
  assert.equal(isBackgroundTag("1girl"), false);
  assert.equal(isBackgroundTag("red eyes"), false);

  // Test analyzeBackground
  const noBg = analyzeBackground(["1girl", "red eyes", "long hair"]);
  assert.equal(noBg.type, "unknown");
  assert.equal(noBg.backgroundTags.length, 0);

  const simpleBg = analyzeBackground(["1girl", "simple background", "white background"]);
  assert.equal(simpleBg.type, "simple");
  assert.deepEqual(simpleBg.backgroundTags, ["simple background", "white background"]);

  const detailedBg = analyzeBackground(["1girl", "forest", "tree", "scenery", "holding sword"]);
  assert.equal(detailedBg.type, "detailed");
  assert.deepEqual(detailedBg.backgroundTags, ["forest", "tree", "scenery"]);

  const mixedBg = analyzeBackground(["1girl", "simple background", "indoors"]);
  assert.equal(mixedBg.type, "mixed");
  assert.deepEqual(mixedBg.backgroundTags, ["simple background", "indoors"]);

  // Test processBackgroundTags
  const tags = ["1girl", "red eyes", "forest", "tree", "scenery"];
  
  // mode: keep
  const keepTags = processBackgroundTags(tags, "keep");
  assert.deepEqual(keepTags, tags);

  // mode: remove_all
  const removeAllTags = processBackgroundTags(tags, "remove_all");
  assert.deepEqual(removeAllTags, ["1girl", "red eyes"]);

  // mode: force_simple
  const forceSimpleTags = processBackgroundTags(tags, "force_simple", "simple background, white background");
  assert.deepEqual(forceSimpleTags, ["1girl", "red eyes", "simple background", "white background"]);

  // mode: force_simple with empty replacement
  const forceSimpleEmpty = processBackgroundTags(tags, "force_simple", "");
  assert.deepEqual(forceSimpleEmpty, ["1girl", "red eyes"]);
  
  // mode: force_simple with no bg tags in original array
  const forceSimpleNoOrigBg = processBackgroundTags(["1girl", "solo"], "force_simple", "simple background");
  assert.deepEqual(forceSimpleNoOrigBg, ["1girl", "solo", "simple background"]);

  // mode: force_simple should also remove scenery tags
  const sceneryTagsForSimple = ["1girl", "red eyes", "sunset", "city"];
  const forceSimpleScenery = processBackgroundTags(sceneryTagsForSimple, "force_simple", "simple background");
  // "sunset" and "city" are scenery, so they should be removed, and replacement added
  assert.deepEqual(forceSimpleScenery, ["1girl", "red eyes", "simple background"]);

  // mode: remove_all (now includes scenery)
  const sceneryTags = ["1girl", "red eyes", "forest", "tree", "scenery", "sunset", "city"];
  const removeAllMode = processBackgroundTags(sceneryTags, "remove_all");
  // "sunset" and "city" are scenery according to tag-classifier, so they should be removed
  assert.deepEqual(removeAllMode, ["1girl", "red eyes"]);

  console.log("✅ All background-detector tests passed!");
