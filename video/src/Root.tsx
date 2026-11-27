import { Composition, Still } from "remotion"
import { DURATION, FPS, POSTER_FRAME } from "./chapters"
import { FeatureIntro } from "./FeatureIntro"
import * as Outfit from "./outfit-chapters"
import { RandomOutfit } from "./RandomOutfit"
import * as Comfy from "./send-to-comfy-chapters"
import { SendToComfy } from "./SendToComfy"
import * as Loops from "./SetupLoops"

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
      <Composition id="SendToComfy" component={SendToComfy} durationInFrames={Comfy.DURATION} fps={Comfy.FPS} width={960} height={720} />
      <Still
        id="SendToComfyPoster"
        component={SendToComfy}
        width={960}
        height={720}
        defaultProps={{ staticFrame: Comfy.POSTER_FRAME, hidePointer: true }}
      />
      <Composition id="ComfyInstallLoop" component={Loops.InstallLoop} durationInFrames={Loops.INSTALL_LOOP_FRAMES} fps={Loops.LOOP.fps} width={Loops.LOOP.width} height={Loops.LOOP.height} />
      <Still
        id="ComfyInstallLoopPoster"
        component={Loops.InstallLoop}
        width={Loops.LOOP.width}
        height={Loops.LOOP.height}
        defaultProps={{ staticFrame: Loops.INSTALL_POSTER_FRAME }}
      />
      <Composition id="ComfyPublishLoop" component={Loops.PublishLoop} durationInFrames={Loops.PUBLISH_LOOP_FRAMES} fps={Loops.LOOP.fps} width={Loops.LOOP.width} height={Loops.LOOP.height} />
      <Still
        id="ComfyPublishLoopPoster"
        component={Loops.PublishLoop}
        width={Loops.LOOP.width}
        height={Loops.LOOP.height}
        defaultProps={{ staticFrame: Loops.PUBLISH_POSTER_FRAME }}
      />
    </>
  )
}
