/**
 * Booru tags -> natural-language prompts without a model call.
 *
 *   const scene = buildScene({ general, characters, copyrights, artists, rating }, overrides)
 *   renderFlux2(scene).text
 *
 * See scene.ts for the intermediate representation and renderers.ts for the
 * per-model output profiles.
 */
export { buildScene, normalizeTag, sceneTagCount, splitPromptTags, titleCase, type NaturalPromptInput, type Scene, type SceneSlot } from "./scene"
export { describeScene, type PhraseDictionary, type PhraseKind, type SceneProse } from "./prose"
export { renderAnima, renderFlux2, type RenderResult } from "./renderers"
