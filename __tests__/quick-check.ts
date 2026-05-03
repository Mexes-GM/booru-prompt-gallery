import { cleanPrompt } from "../lib/cleanPrompt";

type CleanPromptArgs = {
  tagString: string;
  characterString: string;
  thirdArgument: string;
  fourthArgument: string;
  fifthArgument: string;
  provider: 'danbooru';
};

function cleanPromptWithNamedArgs({
  tagString,
  characterString,
  thirdArgument,
  fourthArgument,
  provider,
}: CleanPromptArgs) {
  return cleanPrompt(
    tagString,
    characterString,
    thirdArgument,
    fourthArgument,
  );
}

const tagString = '1girl asuna_(blue_archive) asuna_(bunny)_(blue_archive) ichinose_asuna_(blue_archive) fake_char';
const characterString = 'asuna_(blue_archive) asuna_(bunny)_(blue_archive) ichinose_asuna_(blue_archive) fake_char';
const result = cleanPromptWithNamedArgs({
  tagString,
  characterString,
  thirdArgument: '',
  fourthArgument: '',
  fifthArgument: '',
  provider: 'danbooru',
});
const result2 = cleanPrompt(tagString, "", "", "", { optimizeTags: false });
console.log(result);
console.log(result2);
