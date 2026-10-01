/**
 * Jev Classifier Client
 *
 * Implements batch classification of anime illustration tags into the 33 orthogonal slots
 * defined in docs/jev-tag-taxonomy-and-subcategories.md (Revision 7).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.development.local' });
dotenv.config({ path: '.env.local' });

export const CONFIDENCE_THRESHOLD = 0.70;

/**
 * Original one-line slot descriptions. Superseded by JEV_SLOT_CRITERIA for slot classification;
 * kept for scripts that restrict Jev to a subset of slots.
 */
export const JEV_CRITERIA_33: Record<string, string> = {
  // CLOTHING (9)
  'clothing:outfit': 'Full body garments or combined sets covering torso and legs defining the overall silhouette',
  'clothing:top': 'Modular garments covering the upper torso',
  'clothing:bottom': 'Modular garments covering waist, hips, and upper legs',
  'clothing:underwear': 'Intimate inner garments, lingerie, and undergarments',
  'clothing:headwear': 'Head coverings, hats, and hair-securing wearable accessories',
  'clothing:eyewear': 'Visual aids and eye/facial protective ornaments',
  'clothing:legwear': 'Textile coverings for legs and thighs',
  'clothing:footwear': 'Protective and decorative coverings for the feet',
  'clothing:accents': 'Minor non-bulky wearable accessories attached to body or clothes',

  // EQUIPMENT (2)
  'equipment:weapon': 'Offensive combat armaments, defensive shields, and martial gear carried or wielded by the character',
  'equipment:handheld': 'Portable everyday tools, musical instruments, luggage, personal utility items, or individual foodstuffs carried by hand',

  // POSE (8)
  'pose:camera': 'Perspective, lens distance, viewer angle, and compositional framing or selective feature emphasis',
  'pose:posture': 'Base skeletal whole-body static physical position and stance',
  'pose:gesture': 'Manual hand signs and communicative semiotic body language',
  'pose:expression': 'Facial emotional state, mouth shape, and affective feeling',
  'pose:kinetic': 'Dynamic bodily displacement, whole-body locomotion, athletic maneuvers, and acrobatic trajectory',
  'pose:combat': 'Martial combat maneuvers, offensive fighting strikes, defensive blocks, weapon discharge, and armed engagements',
  'pose:interaction': 'Interpersonal physical contact, social gestures between subjects, reciprocal affection, and shared interpersonal actions',
  'pose:physiological': 'Involuntary biological bodily functions, somatic reflex discharges, and explicit sexual acts',

  // SCENERY (3)
  'scenery:setting': 'Environmental location, architecture, landscape, and container biome',
  'scenery:props': 'Inanimate background furniture, environmental fixtures, ground/air arcane magic circles/glyphs, or banquet spreads arranged as room still-life',
  'scenery:atmosphere': 'Natural illumination, meteorological weather, ambient mood, particles, sparkles, fire, explosions, magical auras, or energy effects',

  // CREATURE (1)
  'creature:animal': 'Non-humanoid biological fauna, wild or domestic species, fantasy beasts, and companion creatures',

  // APPEARANCE (4)
  'appearance:hair': 'Cranial hair styling, pigmentation, length, and arrangement',
  'appearance:eyes': 'Ocular color, iris shape, and pupil characteristics',
  'appearance:anatomy': 'Inherent biological or fantastical humanoid bodily features, physique, and skin',
  'appearance:demographics': 'Subject composition count, gender, and humanoid entity archetype',

  // OTHER (6)
  'other:character': 'Proper names identifying specific fictional individuals',
  'other:copyright': 'Franchise, commercial intellectual property, or source series titles',
  'other:artist': 'Signatures, illustrator names, and credit attributions',
  'other:style': 'Visual artistic medium, graphic rendering technique, aesthetic design movement, or caricaturization format',
  'other:layout': 'Manga/comic page design, reference/model sheets, sequential panels, graphic framing borders, and narrative text containers',
  'other:meta': 'Technical digital file metadata, image resolution, and administrative flags'
};

/** Option Jev picks when no slot describes the tag. Never stored as a slot. */
export const JEV_NONE = 'none';

interface SlotCriterion {
  what: string;
  not_for?: string;
  examples: string[];
}

/**
 * Structured slot criteria (what / not_for / examples), as TypeSafe recommends for options that get
 * confused. Benchmarked against tags where Danbooru's tag-group wiki and Jio7's classification agree
 * (scripts/benchmark-jev-slots.ts, variant v5, held-out half): slot accuracy 77% vs 57% with
 * JEV_CRITERIA_33, and 90% vs 75% among answers at or above CONFIDENCE_THRESHOLD.
 */
const SLOT_CRITERIA: Record<string, SlotCriterion> = {
  'clothing:outfit': {
    what: 'A garment or set that covers torso and legs together or defines the whole look: dresses, full uniforms, costumes, swimsuits, bodysuits, kimono',
    not_for: 'A separate top or bottom worn with other pieces',
    examples: ['dress', 'school uniform', 'serafuku', 'kimono', 'one-piece swimsuit', 'leotard', 'bodysuit', 'maid dress'],
  },
  'clothing:top': {
    what: 'A garment worn on the upper body only: shirts, blouses, jackets, coats, sweaters, hoodies, capes, vests',
    not_for: 'Dresses and full outfits; underwear such as bras',
    examples: ['shirt', 'jacket', 'hoodie', 'sweater', 'cardigan', 'coat', 'crop top', 'tank top'],
  },
  'clothing:bottom': {
    what: 'A garment worn on the hips and legs: skirts, shorts, trousers, and gym shorts such as buruma and bloomers',
    not_for: 'Legwear such as thighhighs or pantyhose; underwear such as panties',
    examples: ['skirt', 'pleated skirt', 'miniskirt', 'shorts', 'pants', 'jeans', 'hakama'],
  },
  'clothing:underwear': {
    what: 'Underwear and lingerie: bras, panties, garters, undershirts',
    not_for: 'Buruma and bloomers (gym shorts, a bottom); garter straps (accents)',
    examples: ['panties', 'bra', 'lingerie', 'garter belt', 'fundoshi', 'boxers'],
  },
  'clothing:headwear': {
    what: 'Anything worn on the head or in the hair: hats, helmets, crowns, hairbands, hair ornaments, hair ribbons',
    not_for: 'The hair itself (length, style, colour); glasses and eyepatches',
    examples: ['hat', 'hair ornament', 'hairband', 'hair bow', 'beret', 'crown', 'helmet', 'hairclip'],
  },
  'clothing:eyewear': {
    what: 'Things worn over the eyes or face: glasses, sunglasses, goggles, eyepatches, masks',
    examples: ['glasses', 'sunglasses', 'goggles', 'eyepatch', 'monocle', 'semi-rimless eyewear'],
  },
  'clothing:legwear': {
    what: 'Coverings for the legs: thighhighs, socks, pantyhose, leg warmers',
    not_for: 'Shoes and boots; skirts and trousers; garter straps and thigh straps (accents)',
    examples: ['thighhighs', 'pantyhose', 'kneehighs', 'socks', 'leg warmers', 'zettai ryouiki'],
  },
  'clothing:footwear': {
    what: 'Shoes and other coverings for the feet',
    not_for: 'Bare feet (a body feature); socks',
    examples: ['boots', 'sneakers', 'high heels', 'sandals', 'loafers', 'mary janes'],
  },
  'clothing:accents': {
    what: 'Small worn accessories that are not on the head: gloves, neckwear, jewellery, belts, collars, wristbands, garter straps and thigh straps, ribbons and buttons on clothes',
    not_for: 'Hair ornaments and hats (headwear)',
    examples: ['gloves', 'necktie', 'choker', 'earrings', 'necklace', 'belt', 'bowtie', 'scarf', 'wristband'],
  },
  'equipment:weapon': {
    what: 'Weapons, armour pieces carried as weapons, and shields, including tags about holding a weapon',
    examples: ['sword', 'gun', 'katana', 'spear', 'rifle', 'shield', 'holding weapon', 'dagger'],
  },
  'equipment:handheld': {
    what: 'Non-weapon objects a character can hold or carry: food, ingredients and dishes, drinks, phones, computers, game consoles and other devices (also when named by brand or model), books, bags, umbrellas, musical instruments and audio gear, including tags about holding such an object',
    not_for: 'Furniture and fixtures that stand in the background (props)',
    examples: ['food', 'cup', 'cellphone', 'book', 'umbrella', 'bag', 'guitar', 'holding cup', 'microphone'],
  },
  'pose:camera': {
    what: 'How the image is framed or viewed: view angle, crop, distance, what the image focuses on, where the subject looks relative to the viewer',
    examples: ['looking at viewer', 'upper body', 'from side', 'cowboy shot', 'full body', 'from below', 'close-up', 'pov'],
  },
  'pose:posture': {
    what: 'The position of the whole body: standing, sitting, lying, kneeling, leaning, how the legs or back are arranged',
    examples: ['sitting', 'standing', 'kneeling', 'on back', 'squatting', 'crossed legs', 'leaning forward'],
  },
  'pose:gesture': {
    what: 'What one character does with their own hands and arms: signs, pointing, waving, hands on own body',
    not_for: 'Touching another person (interaction)',
    examples: ['arms up', 'waving', 'pointing', 'salute', 'hand on hip', 'peace sign', 'hand on own chest'],
  },
  'pose:expression': {
    what: 'The face: emotion, mouth shape, closed or winking eyes, blushing, tears, sweatdrops, and text emoticons that depict a face',
    not_for: 'Eye colour or pupil shape (eyes)',
    examples: ['smile', 'open mouth', 'frown', 'crying', 'tongue out', 'angry', 'grin', 'pout', ':)', '^_^', 'x_x'],
  },
  'pose:kinetic': {
    what: 'Movement of the body: running, jumping, walking, dancing, flying, swimming, falling',
    examples: ['running', 'jumping', 'walking', 'dancing', 'swimming', 'falling'],
  },
  'pose:combat': {
    what: 'Fighting actions: punching, kicking, slashing, aiming, fighting stances, battles',
    examples: ['fighting stance', 'punching', 'kicking', 'aiming', 'battle', 'sword fight'],
  },
  'pose:interaction': {
    what: 'Two or more characters touching or acting on each other in a non-sexual way: hugging, kissing, holding hands, carrying someone',
    not_for: 'Sexual acts (physiological)',
    examples: ['hug', 'kiss', 'holding hands', 'headpat', 'princess carry', "hand on another's head"],
  },
  'pose:physiological': {
    what: 'Bodily fluids and functions and explicit sexual acts: sweat, saliva, tears from arousal, breath, sex, masturbation',
    examples: ['sweat', 'sex', 'cum', 'saliva', 'breath', 'masturbation', 'fellatio', 'heavy breathing'],
  },
  'scenery:setting': {
    what: 'Where the image takes place: indoors or outdoors, rooms, buildings, landscapes, the sky, the background, and named places such as countries, cities or fictional locations',
    examples: ['outdoors', 'indoors', 'beach', 'bedroom', 'classroom', 'forest', 'city', 'street', 'france'],
  },
  'scenery:props': {
    what: 'Furniture and objects placed in the scene rather than held: chairs, beds, tables, windows, lamps, signs',
    not_for: 'Objects a character holds or carries (handheld)',
    examples: ['chair', 'bed', 'table', 'window', 'couch', 'desk', 'pillow', 'curtains'],
  },
  'scenery:atmosphere': {
    what: 'Light, weather, time of day and visual effects: sunlight, night, rain, snow, sparkles, fire, falling petals',
    examples: ['night', 'sunlight', 'rain', 'snow', 'sparkle', 'light rays', 'sunset', 'falling petals'],
  },
  'creature:animal': {
    what: 'Animals and non-humanoid creatures in the image',
    not_for: 'Animal ears, tails or wings on a person (anatomy)',
    examples: ['cat', 'dog', 'bird', 'dragon', 'horse', 'fish', 'rabbit'],
  },
  'appearance:hair': {
    what: 'Hair length, hairstyle and hair colour, including any number of ponytails, tails or drills made of hair',
    not_for: 'Things worn in the hair (headwear)',
    examples: ['long hair', 'blonde hair', 'ponytail', 'twintails', 'bangs', 'ahoge', 'short hair'],
  },
  'appearance:eyes': {
    what: 'Eye colour and the look of the eyes and pupils',
    not_for: 'Closed eyes, winking, crying (expression)',
    examples: ['blue eyes', 'red eyes', 'heterochromia', 'slit pupils', 'glowing eyes', 'eyelashes'],
  },
  'appearance:anatomy': {
    what: 'Body features: breasts, skin, muscles, body parts, animal ears, tails, wings and horns on a character',
    examples: ['large breasts', 'animal ears', 'tail', 'wings', 'horns', 'dark skin', 'navel', 'muscular'],
  },
  'appearance:demographics': {
    what: 'Who and how many subjects are shown: counts, gender, age group, kind of being',
    examples: ['1girl', '1boy', 'solo', 'multiple girls', '2girls', 'elf'],
  },
  'other:character': { what: 'The name of a specific fictional character', examples: ['hatsune miku'] },
  'other:copyright': { what: 'The name of a franchise, work, brand or company', examples: ['touhou', 'pokemon'] },
  'other:artist': { what: 'An artist, signature or credit', examples: [] },
  'other:style': {
    what: 'Art medium and rendering style: monochrome, sketch, painting media, pixel art, chibi',
    examples: ['monochrome', 'greyscale', 'sketch', 'chibi', 'pixel art', 'watercolor (medium)', 'realistic'],
  },
  'other:layout': {
    what: 'Page and panel layout and text in the image: comics, panels, borders, speech bubbles, written text',
    examples: ['comic', 'speech bubble', '4koma', 'border', 'english text', 'multiple views'],
  },
  'other:meta': {
    what: 'Information about the file or the post rather than the picture: resolution, commentary, translation, watermark',
    examples: ['highres', 'absurdres', 'commentary request', 'watermark', 'signature', 'translated'],
  },
};

/** Criteria for the 33-slot question, plus the "none" option. */
export const JEV_SLOT_CRITERIA: Record<string, unknown> = {
  ...Object.fromEntries(
    Object.entries(SLOT_CRITERIA).map(([slot, c]) => [
      slot,
      { what: c.what, ...(c.not_for ? { not_for: c.not_for } : {}), ...(c.examples.length ? { examples: c.examples } : {}) },
    ])
  ),
  [JEV_NONE]: { what: 'None of the other options describes this tag' },
};

/** Taxonomy conventions Jev cannot infer from the slot descriptions alone. */
const SLOT_RULES = [
  'Choose the slot for what the tag shows in the picture.',
  "Tags about holding or carrying an object belong to the object's slot (holding_sword is a weapon, holding_cup is handheld), except holding another person, which is interaction.",
  'Colour, pattern and material variants of a garment or object take the slot of the garment or object (blue_skirt is clothing:bottom).',
  'Animal ears, tails and wings on a character are anatomy; an actual animal is creature:animal.',
  'Choose none when no slot describes the tag.',
  'Text emoticons such as :) or ^_^ describe a facial expression.',
  "Brand and model names of objects (consoles, instruments, devices) belong to the object's slot, not to copyright.",
].join(' ');

/** Instruction for the slot question about the tag at state path `path`. */
export function jevSlotInstructions(path: string): string {
  return `\`${path}\` is a Danbooru tag describing part of an anime illustration. Which taxonomy slot does it belong to? ${SLOT_RULES}`;
}

/** Per-tag state for the slot question: the site, the tag in words, and up to six aliases. */
export function jevSlotState(tag: string, aliases: string[] = []): unknown {
  const words = (t: string) => t.replace(/_/g, ' ');
  return { site: 'Danbooru', tag: words(tag), aliases: aliases.slice(0, 6).map(words) };
}

export interface JevClassificationResult {
  tag: string;
  slot: string;
  category: string;
  subcategory: string;
  confidence: number;
  status: 'approved' | 'needs_review';
  proposed_category?: string;
  proposed_subcategory?: string;
}

function getDefaultTypesafeKey(): string {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    throw new Error('TYPESAFE_API_KEY environment variable is not set');
  }
  return key;
}

export const JEV_ENDPOINT =
  process.env.JEV_API_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';

export const JEV_MODEL =
  process.env.JEV_MODEL || 'jev-1.13.0';

export interface JevChoiceAnswer {
  tag: string;
  /** The chosen criteria key, or null when Jev returned no answer for the tag. */
  choice: string | null;
  /** Probability of every option (sums to 1); empty when Jev returned no answer. */
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevChoiceOptions {
  apiKey?: string;
  /**
   * State stored for each tag. Defaults to the tag with underscores as spaces;
   * return an object to give Jev per-tag context (e.g. `{ name, post_count }`).
   */
  stateFor?: (tag: string) => unknown;
}

/**
 * Asks Jev one `choice` question per tag against an arbitrary set of criteria.
 * Criteria values may be plain descriptions or structured objects (`what`,
 * `not_for`, `examples`, ...), which TypeSafe recommends when options get
 * confused. `instructionsFor` receives the state path of the tag (`tags.T01`)
 * so the question can reference it. Retries with backoff; throws after the
 * last attempt.
 */
export async function askJevChoiceBatch(
  tags: string[],
  criteria: Record<string, unknown>,
  instructionsFor: (statePath: string) => string,
  { apiKey = getDefaultTypesafeKey(), stateFor = (tag) => tag.replace(/_/g, ' ') }: JevChoiceOptions = {}
): Promise<JevChoiceAnswer[]> {
  if (tags.length === 0) return [];
  if (tags.length > 5) {
    throw new Error(`Batch size must be at most 5 tags for Jev stability, received ${tags.length}`);
  }

  const stateTags: Record<string, unknown> = {};
  const questions: Record<string, any> = {};

  tags.forEach((tag, idx) => {
    const id = `T${(idx + 1).toString().padStart(2, '0')}`;
    stateTags[id] = stateFor(tag);
    questions[id] = {
      type: 'choice',
      instructions: instructionsFor(`tags.${id}`),
      criteria
    };
  });

  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: { tags: stateTags },
          questions
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      return tags.map((tag, idx) => {
        const id = `T${(idx + 1).toString().padStart(2, '0')}`;
        const ans = data.answers?.[id];
        return {
          tag,
          choice: typeof ans?.choice === 'string' ? ans.choice : null,
          probabilities: ans?.probabilities ?? {},
          confidence: typeof ans?.confidence === 'number' ? ans.confidence : 0
        };
      });
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      const backoff = Math.min(30000, Math.round(2000 * Math.pow(1.8, attempt - 1)));
      console.warn(`[Jev Retry ${attempt}/${maxAttempts}] ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  return [];
}

/**
 * Slots fixed by the tag's form, so Jev is not asked. `X_(cosplay)` means dressed as character X:
 * a costume, which prompts use like any other outfit.
 */
export function ruleSlotFor(tag: string): string | null {
  return /_\(cosplay\)$/.test(tag) ? 'clothing:outfit' : null;
}

export interface ClassifyOptions {
  apiKey?: string;
  /** Danbooru aliases per tag; they help with abbreviations and romanized names. */
  aliasesFor?: (tag: string) => string[];
}

/**
 * Classifies up to 5 tags into the 33 slots. Answers below CONFIDENCE_THRESHOLD and "none" answers
 * come back as needs_review (other:unclassified); the former keep Jev's pick as the proposal.
 * The second argument may still be a bare API key, as earlier callers pass it.
 */
export async function classifyBatchWithJev(
  tags: string[],
  options: ClassifyOptions | string = {}
): Promise<JevClassificationResult[]> {
  const { apiKey = getDefaultTypesafeKey(), aliasesFor = () => [] } =
    typeof options === 'string' ? { apiKey: options } : options;
  const asked = tags.filter((tag) => !ruleSlotFor(tag));
  const answers = await askJevChoiceBatch(asked, JEV_SLOT_CRITERIA, jevSlotInstructions, {
    apiKey,
    stateFor: (tag) => jevSlotState(tag, aliasesFor(tag)),
  });
  const byTag = new Map(answers.map((a) => [a.tag, a]));

  return tags.map((tag): JevClassificationResult => {
    const ruled = ruleSlotFor(tag);
    if (ruled) {
      const [category, subcategory] = ruled.split(':');
      return { tag, slot: ruled, category, subcategory, confidence: 1, status: 'approved' };
    }
    const { choice, confidence } = byTag.get(tag) ?? { choice: null, confidence: 0 };
    const picked = choice && choice !== JEV_NONE ? choice : null;
    const [cat, subcat] = picked ? picked.split(':') : ['other', 'unclassified'];

    if (picked && confidence >= CONFIDENCE_THRESHOLD) {
      return { tag, slot: picked, category: cat, subcategory: subcat, confidence, status: 'approved' as const };
    }
    return {
      tag,
      slot: picked ?? 'other:unclassified',
      category: 'other',
      subcategory: 'unclassified',
      confidence,
      status: 'needs_review' as const,
      ...(picked ? { proposed_category: cat, proposed_subcategory: subcat } : {}),
    };
  });
}
