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

export async function classifyBatchWithJev(
  tags: string[],
  apiKey: string = getDefaultTypesafeKey()
): Promise<JevClassificationResult[]> {
  const answers = await askJevChoiceBatch(
    tags,
    JEV_CRITERIA_33,
    (path) => `Which taxonomy slot does visual element \`${path}\` belong to?`,
    { apiKey }
  );

  return answers.map(({ tag, choice, confidence }) => {
    const slot = choice || 'other:unclassified';
    const [rawCat, rawSubcat] = slot.split(':');
    const cat = rawCat || 'other';
    const subcat = rawSubcat || 'unclassified';

    if (confidence >= CONFIDENCE_THRESHOLD) {
      return {
        tag,
        slot,
        category: cat,
        subcategory: subcat,
        confidence,
        status: 'approved' as const
      };
    }
    return {
      tag,
      slot,
      category: 'other',
      subcategory: 'unclassified',
      confidence,
      status: 'needs_review' as const,
      proposed_category: cat,
      proposed_subcategory: subcat
    };
  });
}
