/**
 * Booru tags -> natural-language prompts without a model call.
 *
 *   const scene = buildScene({ general, characters, copyrights, artists, rating }, overrides)
 *   renderFlux2(scene).text
 *
 * See scene.ts for the intermediate representation and renderers.ts for the
 * per-model output profiles.
 */
export { attributeTraits, buildScene, normalizeTag, peopleCount, sceneTagCount, splitPromptTags, titleCase, type BuildSceneOptions, type CharacterTraits, type GenderAffinity, type NaturalPromptInput, type Scene, type SceneSlot } from "./scene"
export { describeScene, type PhraseDictionary, type PhraseKind, type SceneProse } from "./prose"
export { FLUX2_DEFAULT_MAX_WORDS, MOSS_DEFAULT_MAX_WORDS, renderAnima, renderFlux2, renderMoss, type ProseOptions, type RenderResult } from "./renderers"
