import { cleanPrompt } from "../lib/cleanPrompt";

const tagString = "1girl, hair between eyes, looking at viewer, black long hair, large breasts, symbol in eye, black corset, heart in eye, patreon logo, black dress, web address, earrings, jewelry, blush, smile, sweat, solo";

const result = cleanPrompt(tagString, "", "", "", { optimizeTags: false });
console.log(result);
