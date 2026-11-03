import { Composition, Still } from "remotion"
import { DURATION, FPS, POSTER_FRAME } from "./chapters"
import { FeatureIntro } from "./FeatureIntro"
import * as Outfit from "./outfit-chapters"
import { RandomOutfit } from "./RandomOutfit"

export function Root() {
  return (
    <>
      <Composition id="PromptFormats" component={FeatureIntro} durationInFrames={DURATION} fps={FPS} width={960} height={720} />
      <Still
        id="PromptFormatsPoster"
        component={FeatureIntro}
        width={960}
        height={720}
        defaultProps={{ staticFrame: POSTER_FRAME, hidePointer: true }}
      />
      <Composition id="RandomOutfit" component={RandomOutfit} durationInFrames={Outfit.DURATION} fps={Outfit.FPS} width={960} height={720} />
      <Still
        id="RandomOutfitPoster"
        component={RandomOutfit}
        width={960}
        height={720}
        defaultProps={{ staticFrame: Outfit.POSTER_FRAME, hidePointer: true }}
      />
    </>
  )
}
