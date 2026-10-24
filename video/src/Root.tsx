import { Composition, Still } from "remotion"
import { DURATION, FPS, POSTER_FRAME } from "./chapters"
import { FeatureIntro } from "./FeatureIntro"

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
    </>
  )
}
