import { parseRawPrompt } from "../lib/reverse-prompt-parser";

const rawPrompt = `ResolutionUnit None
UserComment masterpiece, best quality, very aesthetic, absurdres, masterpiece, best_quality, amazing quality, newest, highly detailed, beautiful lighting, soft reflections, amazing composition, Jeddtl02, flat color, BSSHRGKS, blue hour, late night, dark, mcht2
BREAK
{{(light skin:2)}}, (((elf, ears, 1 girl))), ((blonde platinum hair, medium_hair, blunt bangs, hair flaps)), [messy_hair], ((((expressive eyes, brown eyes)))), (Beautiful face, cute face, kawaii, innocent, Korean girl), ((tall body, medium breasts, slim waist, flat tummy, narrow hips)),
BREAK
((cinematic composition, epic composition, depth of field, dynamic_lighting, detailed_background, dramatic_angle, foreshortening, film grain, lens flare, bokeh, (depth of field:1.1), volumetric lighting, chromatic aberration, ambient occlusion, bloom effect, sharp focus, dynamic background)),
,
(high-angle bird's eye view:1.4), (looking up at viewer:1.3), (standing at the edge of the street:1.1), (traditional school uniform:1.2), (navy blazer:1.1), (white shirt with neck ribbon:1.1), (knit sweater vest:1.2), (pleated mini skirt:1.1), (absolute territory:1.2), (black over-knee socks:1.1), (brown leather loafers:1.1), (school bag in hand:1.1), (scenic ginkgo tree-lined street:1.3), (leaves fluttering in the wind:1.2), (urban street edge:1.1), (cinematic golden hour lighting:1.3), (warm sunbeams filtering through trees:1.3), (volumetric lighting:1.2), (soft bloom:1.2), (lens flare:1.1), (depth of field:1.4), (sharp focus on girl:1.3), (blurred golden background:1.2), (subsurface scattering on skin:1.1), , <lora:51df16f0-8196-4d73-9f45-bcc0514a4893:0.7>, <lora:b30db7ae-1588-4c3c-ac9c-7300908eb343:0.4>, <lora:6023c98a-7213-43e7-8625-1efe4e41b205:0.7>, <lora:31303ad8-bfad-4c88-a167-7d46f1927128:0.9>, <lora:b630c5bf-6eb8-4fea-8b59-20d80b9521cd:0.5>
Negative prompt: lowres, bad quality, worst quality, (((((bad anatomy))))), sketch, jpeg artifacts, ugly, poorly drawn, censor, blurry, watermark, simple background, transparent background, (((watermark))), signature, artist name, neutral, mean, intense, ugly, old, striped face, black stripes, bad hands, bad fingers , low res, bad quality, low quality, ,EasynegativeV2, {{{missing fingers, extra fingers}}}, (bad face), long neck, long torso, neghand, bad feet, bad legs, , a90b2b7f-2043-493d-9af7-bf0afe7609d5
Steps: 30, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7.0, Seed: 2337432466, Size: 768x1344, Model hash: 416daecfbe, Model: 554a4380-1a6e-4d6d-ad2d-3f53463f180e, VAE hash: d7ed5ca5fd, VAE: illustriousXLV20_v10.safetensors, Denoising strength: 0.5, Clip skip: 2, ADetailer model: face_yolov8n.pt, ADetailer confidence: 0.3, ADetailer dilate erode: 4, ADetailer mask blur: 4, ADetailer denoising strength: 0.4, ADetailer inpaint only masked: True, ADetailer inpaint padding: 32, ADetailer version: 24.11.1, Hires upscale: 2.0, Hires steps: 20, Hires upscaler: R-ESRGAN 4x+ Anime6B, Lora hashes: "51df16f0-8196-4d73-9f45-bcc0514a4893: 0691f9b28b2a, b30db7ae-1588-4c3c-ac9c-7300908eb343: ec445f789fbe, 6023c98a-7213-43e7-8625-1efe4e41b205: eae24e11decd, 31303ad8-bfad-4c88-a167-7d46f1927128: e1665a43ad22, b630c5bf-6eb8-4fea-8b59-20d80b9521cd: 310ff897dd30", Emphasis: No norm, NGMS: 1.5, Version: 1.10.1`;

function run() {
  const result = parseRawPrompt(rawPrompt);
  
  if (!result.cleanedTags.includes("masterpiece") || result.cleanedTags.includes("resolutionunit none") || result.cleanedTags.includes("usercomment masterpiece")) {
    console.error("❌ Test failed: EXIF garbage tags were not removed.");
    process.exitCode = 1;
    return;
  }
  if (!result.cleanedTags.includes("break")) {
    console.error("❌ Test failed: BREAK tag was improperly lost.");
    process.exitCode = 1;
    return;
  }
  
  console.log("✅ reverse-prompt-parser tests passed!");
}

run();

run();