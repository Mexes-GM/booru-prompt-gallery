import { normalize } from "./cleanPrompt"

export interface TagConflictRule {
  blocks: string[];
  exceptions?: Record<string, string[]>;
}

// Global dictionary of contradictions and edge-cases in tagging
// Expanded with 100+ real tag conflicts from Danbooru analysis
export const TAG_CONFLICTS: Record<string, TagConflictRule> = {
  // === CHARACTER COUNT & GENDER (10 tags) ===
  "1girl": {
    blocks: ["2girls", "3girls", "4girls", "5girls", "6+girls", "7+girls", "8+girls", "9+girls",
             "1boy", "2boys", "3boys", "4boys", "5boys", "6+boys", "7+boys", "8+boys", "9+boys",
             "multiple_boys", "no_humans"],
    exceptions: {}
  },
  "1boy": {
    blocks: ["2boys", "3boys", "4boys", "5boys", "6+boys", "7+boys", "8+boys", "9+boys",
             "1girl", "2girls", "3girls", "4girls", "5girls", "6+girls", "7+girls", "8+girls", "9+girls",
             "multiple_girls", "no_humans"],
    exceptions: {}
  },
  "solo": {
    blocks: ["2girls", "2boys", "3girls", "3boys", "multiple girls", "multiple boys", "couple", "group", "6+boys", "6+girls"],
    exceptions: {}
  },
  "multiple girls": {
    blocks: ["solo", "1girl"],
    exceptions: {}
  },
  "multiple boys": {
    blocks: ["solo", "1boy"],
    exceptions: {}
  },
  "2girls": {
    blocks: ["solo", "1girl", "3girls", "4girls", "5girls", "6+girls"],
    exceptions: {}
  },
  "2boys": {
    blocks: ["solo", "1boy", "3boys", "4boys", "5boys", "6+boys"],
    exceptions: {}
  },
  "3girls": {
    blocks: ["solo", "1girl", "2girls", "4girls", "5girls", "6+girls"],
    exceptions: {}
  },
  "couple": {
    blocks: ["solo", "group"],
    exceptions: {}
  },
  "group": {
    blocks: ["solo", "couple"],
    exceptions: {}
  },

  // === CAMERA ANGLES & FRAMING / SHOTS (12 tags) ===
  "upper_body": {
    blocks: [
      "legs", "feet", "barefoot", "boots", "shoes", "sneakers", "high_heels", "sandals", "slippers",
      "pants", "skirt", "underwear", "panties", "jeans", "shorts", "leggings",
      "thighhighs", "kneehighs", "pantyhose", "stockings", "tights", "socks",
      "pelvis", "crotch", "hips", "thighs", "knees", "calves", "ankles", "toes",
      "full_body", "lower_body", "standing", "kneeling", "squatting"
    ],
    exceptions: {
      "cowboy_shot": ["thighs", "skirt", "shorts", "panties", "pelvis", "crotch", "hips"]
    }
  },
  "lower_body": {
    blocks: [
      "breasts", "cleavage", "chest", "face", "head", "smile", "eyes", "blush", "mouth", "lips",
      "blue_eyes", "red_eyes", "green_eyes", "closed_eyes", "looking_at_viewer", "hair",
      "neck", "shoulders", "arms", "hands", "fingers",
      "shirt", "jacket", "bra", "top", "sweater", "hoodie", "hat", "earrings", "necklace",
      "full_body", "upper_body", "portrait", "headshot", "close_up"
    ],
    exceptions: {
      "hands_on_hips": ["hands", "fingers", "arms"],
      "arms_down": ["arms", "hands", "fingers"]
    }
  },
  "full_body": {
    blocks: ["upper_body", "lower_body", "close_up", "headshot", "portrait"],
    exceptions: {}
  },
  "close_up": {
    blocks: [
      "full_body", "standing", "walking", "running", "kneeling", "squatting", "sitting",
      "legs", "lower_body", "feet", "shoes", "pants", "skirt", "thighs", "hips", "waist"
    ],
    exceptions: {
      "portrait": ["full_body", "lower_body"]
    }
  },
  "headshot": {
    blocks: [
      "full_body", "lower_body", "upper_body",
      "legs", "feet", "barefoot", "boots", "shoes", "sneakers", "high_heels",
      "pants", "skirt", "underwear", "thighs", "hips", "waist", "pelvis", "crotch",
      "chest", "breasts", "cleavage", "navel", "stomach",
      "arms", "hands", "fingers",
      "standing", "kneeling", "sitting", "squatting", "walking", "running"
    ],
    exceptions: {
      "hand_on_face": ["hands", "fingers", "arms"],
      "adjusting_glasses": ["hands", "fingers", "arms"],
      "smoking": ["hands", "fingers", "arms"]
    }
  },
  "portrait": {
    blocks: [
      "full_body", "lower_body",
      "legs", "feet", "barefoot", "shoes", "boots", "sneakers", "high_heels",
      "pants", "skirt", "shorts", "thighs", "knees", "calves", "pelvis", "crotch",
      "navel", "stomach", "standing", "walking", "running", "kneeling"
    ],
    exceptions: {}
  },
  "cowboy_shot": {
    blocks: [
      "full_body", "headshot", "lower_body",
      "feet", "barefoot", "shoes", "boots", "sneakers", "high_heels", "sandals", "slippers",
      "calves", "ankles", "toes", "socks", "anklet", "knees", "kneehighs"
    ],
    exceptions: {
      "upper_body": []
    }
  },
  "from_above": {
    blocks: ["from_below", "under_skirt", "panties_under_skirt"],
    exceptions: {}
  },
  "from_below": {
    blocks: ["from_above", "cleavage"],
    exceptions: {}
  },
  "from_behind": {
    blocks: [
      "lips", "nose", "eyes", "mouth", "smile", "blush", "tears",
      "front_tie", "collarbone", "facing_viewer", "breasts", "cleavage", "chest", "navel", "stomach"
    ],
    exceptions: {
      "looking_back": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears"],
      "looking_over_shoulder": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears"],
      "profile": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears"],
      "mirror_reflection": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears", "breasts", "cleavage", "chest", "navel", "stomach"],
      "mirror": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears", "breasts", "cleavage", "chest", "navel", "stomach"],
      "selfie": ["lips", "nose", "eyes", "mouth", "smile", "blush", "tears", "face"]
    }
  },
  "profile": {
    blocks: ["cleavage", "facing_viewer", "both_eyes", "front_tie"],
    exceptions: {}
  },
  "facing_viewer": {
    blocks: ["from_behind", "profile", "back", "butt", "ass"],
    exceptions: {
      "looking_back": ["back", "butt", "ass"],
      "looking_over_shoulder": ["back", "butt", "ass"]
    }
  },

  // === CLOTHING & WEARABLES (22 tags) ===
  "nude": {
    blocks: [
      "clothed", "fully clothed", "dress", "shirt", "pants", "skirt", "jacket", "coat", "uniform",
      "bikini", "swimsuit", "lingerie", "bra", "underwear", "panties", "thong", "jeans", "shorts",
      "leggings", "pantyhose", "stockings", "thighhighs", "tights", "socks",
      "shoes", "boots", "sneakers", "sandals", "high_heels", "slippers",
      "black_shirt", "collared_shirt", "t-shirt", "sweater", "hoodie", "long_sleeves", "tank_top", "camisole"
    ],
    exceptions: {
      "naked_apron": ["apron"],
      "naked_cape": ["cape", "cloak"],
      "naked_ribbon": ["ribbon"],
      "naked_towel": ["towel"],
      "towel": ["towel"],
      "bath_towel": ["towel"]
    }
  },
  "naked": {
    blocks: [
      "clothed", "fully clothed", "dress", "shirt", "pants", "skirt", "jacket", "coat", "uniform",
      "bikini", "swimsuit", "lingerie", "bra", "underwear", "panties", "thong", "jeans", "shorts",
      "leggings", "pantyhose", "stockings", "thighhighs", "tights", "socks",
      "shoes", "boots", "sneakers", "sandals", "high_heels", "slippers",
      "t-shirt", "sweater", "hoodie", "long_sleeves", "tank_top"
    ],
    exceptions: {
      "naked_apron": ["apron"],
      "naked_towel": ["towel"],
      "towel": ["towel"],
      "bath_towel": ["towel"]
    }
  },
  "clothed": {
    blocks: ["nude", "naked", "topless", "bottomless", "exposed", "bare_breasts", "pussy"],
    exceptions: {}
  },
  "fully clothed": {
    blocks: ["nude", "naked", "topless", "bottomless", "exposed", "underwear", "panties", "bra", "swimsuit", "bikini", "lingerie", "bare_breasts", "pussy"],
    exceptions: {}
  },
  "topless": {
    blocks: [
      "shirt", "jacket", "coat", "fully clothed", "clothed", "sweater", "hoodie", "long_sleeves",
      "t-shirt", "tank_top", "camisole", "bra", "bikini_top", "dress", "uniform"
    ],
    exceptions: {
      "open_jacket": ["jacket", "coat"],
      "open_shirt": ["shirt", "collared_shirt"],
      "open_clothes": ["shirt", "jacket"]
    }
  },
  "bottomless": {
    blocks: [
      "pants", "skirt", "shorts", "jeans", "leggings", "underwear", "panties", "thong",
      "pantyhose", "tights", "swimsuit", "bikini_bottom", "fully clothed", "clothed"
    ],
    exceptions: {
      "shirt_lift": ["shirt", "t-shirt"],
      "skirt_lift": ["skirt"]
    }
  },
  "bare_shoulders": {
    blocks: ["long_sleeves", "sweater", "heavy_coat", "jacket", "collared_shirt", "t-shirt", "hoodie"],
    exceptions: {}
  },
  "long_sleeves": {
    blocks: ["bare_shoulders", "sleeveless", "short_sleeves", "tank_top", "topless", "bare_arms", "nude", "naked"],
    exceptions: {}
  },
  "skirt": {
    blocks: ["pants", "jeans", "shorts", "nude", "naked", "bottomless"],
    exceptions: {}
  },
  "dress": {
    blocks: ["shirt", "pants", "jeans", "shorts", "swimsuit", "bikini", "nude", "naked", "topless", "bottomless"],
    exceptions: {}
  },
  "hat": {
    blocks: ["unworn_hat", "unworn_headwear", "bare_head"],
    exceptions: {
      "hood_up": ["unworn_hat"],
      "beanie": ["unworn_hat"]
    }
  },
  "unworn_hat": {
    blocks: ["hat", "hood_up", "beanie", "wearing_hat"],
    exceptions: {}
  },
  "gloves": {
    blocks: ["bare_hands", "hands_in_pockets"],
    exceptions: {
      "fingerless_gloves": ["bare_hands"]
    }
  },
  "bare_hands": {
    blocks: ["gloves", "mittens", "gauntlets"],
    exceptions: {
      "fingerless_gloves": ["gloves"]
    }
  },
  "swimsuit": {
    blocks: ["winter_clothes", "heavy_coat", "armor", "business_suit", "fully clothed", "nude", "naked", "sweater", "jacket", "jeans"],
    exceptions: {}
  },
  "bikini": {
    blocks: ["fully clothed", "nude", "naked", "winter_clothes", "heavy_coat", "sweater", "jeans", "dress"],
    exceptions: {}
  },
  "collared_shirt": {
    blocks: ["t-shirt", "tank_top", "bare_chest", "topless", "nude", "naked"],
    exceptions: {}
  },
  "high_heels": {
    blocks: ["sneakers", "barefoot", "flat_shoes", "sandals", "slippers"],
    exceptions: {}
  },
  "scarf": {
    blocks: ["bare_neck", "turtleneck"],
    exceptions: {}
  },
  "boots": {
    blocks: ["barefoot", "open_toe", "sandals", "slippers", "sneakers"],
    exceptions: {}
  },
  "pantyhose": {
    blocks: ["bare_legs", "barefoot"],
    exceptions: {
      "toeless_legwear": ["barefoot"]
    }
  },
  "barefoot": {
    blocks: [
      "shoes", "boots", "sneakers", "socks", "high_heels", "sandals", "slippers", "loafers",
      "pantyhose", "tights", "stockings", "thighhighs", "kneehighs"
    ],
    exceptions: {
      "toeless_legwear": ["pantyhose", "tights", "stockings", "thighhighs", "kneehighs"]
    }
  },

  // === POSES & POSTURE (17 tags) ===
  "standing": {
    blocks: ["sitting", "lying_down", "kneeling", "squatting", "crawling", "floating", "crouching", "seiza", "indian_style", "on_stomach", "on_back", "on_side"],
    exceptions: {
      "standing_on_one_leg": ["kneeling", "squatting"]
    }
  },
  "sitting": {
    blocks: ["standing", "lying_down", "kneeling", "walking", "running", "crouching", "crawling", "on_stomach", "on_back", "on_side", "jumping"],
    exceptions: {}
  },
  "lying_down": {
    blocks: ["standing", "sitting", "kneeling", "jumping", "running", "walking", "crouching", "squatting", "seiza", "indian_style"],
    exceptions: {}
  },
  "kneeling": {
    blocks: ["standing", "sitting", "lying_down", "running", "walking", "crawling", "floating", "on_stomach", "on_back", "on_side", "jumping"],
    exceptions: {}
  },
  "squatting": {
    blocks: ["standing", "sitting", "lying_down", "running", "walking", "crawling", "floating", "on_stomach", "on_back", "on_side", "jumping", "kneeling"],
    exceptions: {
      "asian_squat": ["kneeling"]
    }
  },
  "walking": {
    blocks: ["sitting", "lying_down", "sleeping", "standing_still", "kneeling", "squatting", "crawling", "seiza", "indian_style"],
    exceptions: {
      "sleepwalking": ["sleeping"]
    }
  },
  "running": {
    blocks: ["sitting", "lying_down", "sleeping", "standing_still", "walking_slowly", "kneeling", "squatting", "crawling", "seiza", "indian_style"],
    exceptions: {}
  },
  "jumping": {
    blocks: ["sitting", "lying_down", "sleeping", "kneeling", "squatting", "crawling", "seiza", "indian_style", "standing_still"],
    exceptions: {}
  },
  "arms_up": {
    blocks: ["arms_down", "arms_behind_back", "hands_in_pockets", "arms_crossed", "hands_on_hips", "hands_on_own_chest"],
    exceptions: {}
  },
  "arms_down": {
    blocks: ["arms_up", "arms_behind_back", "hands_in_pockets", "arms_crossed", "hands_on_hips", "hands_on_own_chest", "hands_on_head", "hands_on_face"],
    exceptions: {}
  },
  "arms_behind_back": {
    blocks: ["arms_up", "arms_down", "reaching_out", "holding", "arms_crossed", "hands_on_hips", "hands_on_own_chest", "hands_on_head", "hands_on_face", "hands_in_pockets"],
    exceptions: {}
  },
  "hands_in_pockets": {
    blocks: ["holding", "reaching_out", "arms_up", "arms_behind_back", "arms_crossed", "hands_on_hips", "hands_on_own_chest", "hands_on_head", "hands_on_face"],
    exceptions: {
      "one_hand_in_pocket": ["holding", "reaching_out", "arms_up"]
    }
  },
  "arms_crossed": {
    blocks: ["arms_up", "arms_down", "arms_behind_back", "hands_in_pockets", "reaching_out", "holding", "hands_on_hips"],
    exceptions: {}
  },
  "legs_apart": {
    blocks: ["knees_together_feet_apart", "crossed_legs", "knees_together", "feet_together"],
    exceptions: {}
  },
  "crossed_legs": {
    blocks: ["legs_apart", "knees_apart", "feet_apart"],
    exceptions: {}
  },
  "floating": {
    blocks: ["standing", "sitting", "lying_down", "kneeling", "walking", "running", "squatting", "crawling", "seiza", "indian_style"],
    exceptions: {}
  },
  "crouching": {
    blocks: ["standing", "sitting", "lying_down", "walking", "running", "jumping"],
    exceptions: {}
  },

  // === HAIR & PHYSICAL ATTRIBUTES (24 tags) ===
  "smile": {
    blocks: ["crying", "sad", "angry", "frowning", "disappointed", "scared", "pouting", "scowling", "yelling", "screaming", "crying_with_eyes_open"],
    exceptions: {
      "tears_of_joy": ["crying", "tears"],
      "sad_smile": ["sad"],
      "smirk": ["pouting"]
    }
  },
  "happy": {
    blocks: ["crying", "sad", "angry", "frowning", "depressed", "scared", "pouting"],
    exceptions: {
      "tears_of_joy": ["crying", "tears"]
    }
  },
  "crying": {
    blocks: ["smile", "laughing", "happy", "calm", "content", "grinning", "smug"],
    exceptions: {
      "tears_of_joy": ["smile", "happy", "laughing", "grinning"]
    }
  },
  "angry": {
    blocks: ["smile", "happy", "calm", "peaceful", "content", "laughing", "grinning"],
    exceptions: {}
  },
  "sleeping": {
    blocks: [
      "awake", "eyes_open", "staring", "alert", "looking_at_viewer", "looking_away", "looking_to_the_side",
      "standing", "walking", "running", "fighting", "dancing", "reading"
    ],
    exceptions: {
      "sleepwalking": ["walking", "standing"],
      "half-asleep": ["eyes_open", "looking_at_viewer", "looking_away"],
      "drowsy": ["eyes_open", "looking_at_viewer"]
    }
  },
  "closed_eyes": {
    blocks: [
      "eyes_open", "staring", "looking_at_viewer", "looking_away", "looking_to_the_side", "looking_up", "looking_down",
      "blue_eyes", "red_eyes", "green_eyes", "yellow_eyes", "purple_eyes", "pink_eyes", "brown_eyes", "black_eyes", "white_eyes", "gray_eyes", "orange_eyes",
      "heterochromia", "glowing_eyes", "slit_pupils", "symbol-shaped_pupils", "heart-shaped_pupils", "star-shaped_pupils", "wide_eyed", "constricted_pupils"
    ],
    exceptions: {
      "one_eye_closed": ["looking_at_viewer", "looking_away", "looking_to_the_side", "looking_up", "looking_down", "blue_eyes", "red_eyes", "green_eyes", "yellow_eyes", "purple_eyes", "pink_eyes", "brown_eyes", "black_eyes", "white_eyes", "gray_eyes", "orange_eyes", "heterochromia", "glowing_eyes", "slit_pupils", "symbol-shaped_pupils", "heart-shaped_pupils", "star-shaped_pupils", "wide_eyed", "constricted_pupils"],
      "winking": ["looking_at_viewer", "looking_away", "looking_to_the_side", "looking_up", "looking_down", "blue_eyes", "red_eyes", "green_eyes", "yellow_eyes", "purple_eyes", "pink_eyes", "brown_eyes", "black_eyes", "white_eyes", "gray_eyes", "orange_eyes", "heterochromia", "glowing_eyes", "slit_pupils", "symbol-shaped_pupils", "heart-shaped_pupils", "star-shaped_pupils", "wide_eyed", "constricted_pupils"]
    }
  },
  "eyes_open": {
    blocks: ["eyes_closed", "sleeping", "winking", "sleeping_while_standing"],
    exceptions: {}
  },
  "winking": {
    blocks: ["both_eyes_open", "eyes_closed", "sleeping"],
    exceptions: {}
  },
  "looking_at_viewer": {
    blocks: ["looking_away", "looking_to_the_side", "looking_down", "looking_up", "eyes_closed", "profile", "from_behind", "sleeping"],
    exceptions: {
      "looking_back": ["from_behind"],
      "looking_over_shoulder": ["from_behind"]
    }
  },
  "looking_away": {
    blocks: ["looking_at_viewer", "staring", "eyes_closed", "sleeping"],
    exceptions: {}
  },
  "looking_to_the_side": {
    blocks: ["looking_at_viewer", "facing_viewer", "eyes_closed", "sleeping"],
    exceptions: {}
  },
  "open_mouth": {
    blocks: ["closed_mouth", "clenched_teeth", "puckered_lips", "pouting", "biting_lip"],
    exceptions: {
      "tongue_out": ["open_mouth"]
    }
  },
  "closed_mouth": {
    blocks: ["open_mouth", "yelling", "screaming", "laughing", "tongue_out", "teeth", "fangs", "biting_own_lip"],
    exceptions: {
      "parted_lips": ["open_mouth"]
    }
  },
  "blush": {
    blocks: ["pale", "pale_skin"],
    exceptions: {}
  },
  "tongue_out": {
    blocks: ["closed_mouth", "clenched_teeth", "biting_lip"],
    exceptions: {}
  },
  "laughing": {
    blocks: ["crying", "sleeping", "serious", "closed_mouth", "angry", "sad", "pouting"],
    exceptions: {
      "tears_of_joy": ["crying", "tears"]
    }
  },
  "screaming": {
    blocks: ["closed_mouth", "whispering", "calm", "sleeping", "peaceful", "smile", "laughing"],
    exceptions: {}
  },
  "yelling": {
    blocks: ["closed_mouth", "whispering", "sleeping", "peaceful", "calm"],
    exceptions: {}
  },
  "sad": {
    blocks: ["happy", "smile", "laughing", "grinning", "smug"],
    exceptions: {
      "sad_smile": ["smile"]
    }
  },
  "peaceful": {
    blocks: ["fighting", "angry", "scared", "screaming", "yelling", "crying"],
    exceptions: {}
  },
  "content": {
    blocks: ["crying", "sad", "angry", "screaming", "yelling", "scared"],
    exceptions: {}
  },
  "kissing": {
    blocks: ["open_mouth", "yelling", "screaming", "laughing", "tongue_out", "talking"],
    exceptions: {
      "french_kiss": ["open_mouth", "tongue_out"]
    }
  },

  // === HAIR & PHYSICAL ATTRIBUTES (24 tags) ===
  "short_hair": {
    blocks: ["long_hair", "very_long_hair", "floor-length_hair", "waist-length_hair", "knee-length_hair", "calf-length_hair", "ankle-length_hair", "twin_braids", "twintails", "ponytail"],
    exceptions: {
      "short_ponytail": ["ponytail"],
      "short_twintails": ["twintails"]
    }
  },
  "long_hair": {
    blocks: ["short_hair", "pixie_cut", "buzz_cut", "bald", "medium_hair", "bob_cut", "crew_cut", "very_short_hair"],
    exceptions: {}
  },
  "very_long_hair": {
    blocks: ["short_hair", "medium_hair", "pixie_cut", "buzz_cut", "bald", "bob_cut", "very_short_hair"],
    exceptions: {}
  },
  "floor-length_hair": {
    blocks: ["short_hair", "medium_hair", "long_hair", "waist-length_hair", "knee-length_hair", "pixie_cut", "buzz_cut", "bald", "bob_cut", "very_short_hair"],
    exceptions: {}
  },
  "straight_hair": {
    blocks: ["curly_hair", "wavy_hair", "drill_hair", "ringlets"],
    exceptions: {}
  },
  "curly_hair": {
    blocks: ["straight_hair", "wavy_hair"],
    exceptions: {}
  },
  "wavy_hair": {
    blocks: ["straight_hair", "curly_hair", "drill_hair", "ringlets"],
    exceptions: {}
  },
  "dark_skin": {
    blocks: ["pale_skin", "fair_skin", "white_skin", "light_skin", "porcelain_skin", "translucent_skin"],
    exceptions: {}
  },
  "pale_skin": {
    blocks: ["dark_skin", "tan", "tanned", "tanned_skin", "brown_skin", "sun_kissed"],
    exceptions: {
      "tan_lines": ["tan", "tanned"]
    }
  },
  "flat_chest": {
    blocks: ["large_breasts", "huge_breasts", "gigantic_breasts", "cleavage", "busty", "medium_breasts"],
    exceptions: {}
  },
  "small_breasts": {
    blocks: ["large_breasts", "huge_breasts", "gigantic_breasts", "busty"],
    exceptions: {}
  },
  "large_breasts": {
    blocks: ["flat_chest", "small_breasts", "pettanko", "micro_breasts"],
    exceptions: {}
  },
  "huge_breasts": {
    blocks: ["flat_chest", "small_breasts", "medium_breasts", "pettanko", "micro_breasts"],
    exceptions: {}
  },
  "tall": {
    blocks: ["short", "chibi", "petite", "tiny"],
    exceptions: {}
  },
  "short": {
    blocks: ["tall", "mature_female", "mature_male", "giant", "giantess"],
    exceptions: {}
  },
  "chibi": {
    blocks: ["tall", "mature_female", "mature_male", "muscular", "curvy", "giant", "giantess"],
    exceptions: {}
  },
  "muscular": {
    blocks: ["skinny", "chubby", "fat", "delicate", "slim", "obese"],
    exceptions: {
      "muscle_girl": ["delicate"]
    }
  },
  "chubby": {
    blocks: ["skinny", "slim", "muscular", "ripped", "shredded", "emaciated"],
    exceptions: {}
  },
  "fat": {
    blocks: ["skinny", "slim", "muscular", "ripped", "shredded", "emaciated"],
    exceptions: {}
  },
  "skinny": {
    blocks: ["chubby", "fat", "muscular", "plump", "obese", "curvy", "voluptuous"],
    exceptions: {}
  },
  "slim": {
    blocks: ["chubby", "fat", "plump", "obese", "muscular", "ripped"],
    exceptions: {}
  },
  "curvy": {
    blocks: ["flat_chest", "skinny", "anorexic", "boyish_figure"],
    exceptions: {}
  },

  // === HAIR STYLES & ACCESSORIES (12 tags) ===
  "ponytail": {
    blocks: ["hair_down", "loose_hair", "twintails", "twin_braids", "updo", "hair_bun"],
    exceptions: {
      "side_ponytail": ["hair_down"],
      "half_updo": ["hair_down", "loose_hair"]
    }
  },
  "twintails": {
    blocks: ["hair_down", "loose_hair", "ponytail", "single_braid", "hair_bun", "updo"],
    exceptions: {
      "half_updo": ["hair_down", "loose_hair"]
    }
  },
  "double_bun": {
    blocks: ["hair_down", "loose_hair", "ponytail", "single_braid"],
    exceptions: {}
  },
  "hair_bun": {
    blocks: ["hair_down", "loose_hair", "twintails", "twin_braids"],
    exceptions: {
      "half_updo": ["hair_down", "loose_hair"]
    }
  },
  "hair_down": {
    blocks: ["ponytail", "twintails", "double_bun", "hair_bun", "updo", "braid", "braids", "french_braid"],
    exceptions: {}
  },
  "loose_hair": {
    blocks: ["ponytail", "twintails", "double_bun", "hair_bun", "updo", "braid", "braids", "french_braid"],
    exceptions: {}
  },
  "braids": {
    blocks: ["loose_hair", "hair_down"],
    exceptions: {}
  },
  "heterochromia": {
    blocks: ["closed_eyes"],
    exceptions: {}
  },
  "animal_ears": {
    blocks: ["bare_ears", "human_ears"],
    exceptions: {
      "four_ears": ["human_ears"]
    }
  },
  "cat_ears": {
    blocks: ["human_ears", "dog_ears", "fox_ears", "wolf_ears", "bunny_ears"],
    exceptions: {
      "four_ears": ["human_ears"]
    }
  },
  "cat_tail": {
    blocks: ["no_tail", "dog_tail", "fox_tail", "wolf_tail", "bunny_tail"],
    exceptions: {
      "multiple_tails": ["dog_tail", "fox_tail", "wolf_tail", "bunny_tail"]
    }
  },

  // === ENVIRONMENT & SETTING (18 tags) ===
  "day": {
    blocks: ["night", "sunset", "dusk", "twilight", "pitch_black", "starry_sky", "midnight", "moon"],
    exceptions: {}
  },
  "night": {
    blocks: ["day", "sun", "sunlight", "midday", "bright", "blue_sky", "cloudless_sky", "morning"],
    exceptions: {}
  },
  "sunset": {
    blocks: ["midday", "night", "pitch_black", "midnight", "starry_sky"],
    exceptions: {}
  },
  "twilight": {
    blocks: ["midday", "night", "sun", "bright"],
    exceptions: {}
  },
  "indoors": {
    blocks: ["outdoors", "sky", "forest", "beach", "street", "open_air", "nature", "cityscape", "cloud", "sun", "mountain", "ocean", "stars"],
    exceptions: {
      "window": ["sky", "cityscape", "mountain", "ocean", "sun", "cloud", "stars"]
    }
  },
  "outdoors": {
    blocks: ["indoors", "room", "bedroom", "classroom", "inside", "ceiling", "indoor_lighting", "living_room", "bathroom"],
    exceptions: {}
  },
  "white_background": {
    blocks: ["detailed_background", "scenery", "cityscape", "landscape", "forest", "beach", "indoors", "outdoors", "sky", "room"],
    exceptions: {}
  },
  "simple_background": {
    blocks: ["detailed_background", "scenery", "cityscape", "landscape", "forest", "beach", "indoors", "outdoors"],
    exceptions: {}
  },
  "transparent_background": {
    blocks: ["detailed_background", "scenery", "cityscape", "landscape", "forest", "beach", "indoors", "outdoors", "sky"],
    exceptions: {}
  },
  "detailed_background": {
    blocks: ["white_background", "transparent_background", "simple_background", "solid_color_background"],
    exceptions: {}
  },
  "beach": {
    blocks: ["indoors", "mountain", "snow", "space", "forest", "desert", "room", "cityscape"],
    exceptions: {}
  },
  "snow": {
    blocks: ["summer", "beach", "desert", "tropical", "sunflower"],
    exceptions: {}
  },
  "winter_clothes": {
    blocks: ["summer", "bikini", "swimsuit", "beach", "tropical"],
    exceptions: {}
  },
  "rain": {
    blocks: ["sunny", "clear_sky", "dry", "indoors"],
    exceptions: {
      "window": ["indoors"],
      "umbrella": ["dry"]
    }
  },
  "sunny": {
    blocks: ["rain", "clouds", "overcast", "heavy_rain", "storm", "night", "starry_sky"],
    exceptions: {}
  },
  "underwater": {
    blocks: ["sky", "space", "dry", "indoors", "mountains", "rain", "snow", "fire", "cloud"],
    exceptions: {
      "aquarium": ["indoors"]
    }
  },
  "sky": {
    blocks: ["indoors", "bathroom", "bedroom", "underwater", "cave"],
    exceptions: {
      "window": ["indoors", "bedroom", "bathroom"]
    }
  },

  // === ACTIONS & STATES (15 tags) ===
  "fighting": {
    blocks: ["peaceful", "relaxing", "sleeping", "playing", "calm", "reading"],
    exceptions: {}
  },
  "eating": {
    blocks: ["sleeping", "closed_mouth", "talking", "fighting", "kissing", "yelling"],
    exceptions: {}
  },
  "drinking": {
    blocks: ["sleeping", "closed_mouth", "talking", "kissing", "yelling"],
    exceptions: {}
  },
  "holding": {
    blocks: ["empty_hands", "hands_in_pockets", "arms_behind_back", "arms_crossed"],
    exceptions: {}
  },
  "reading": {
    blocks: ["sleeping", "fighting", "running", "dancing", "swimming", "eyes_closed"],
    exceptions: {}
  },
  "flying": {
    blocks: ["standing", "sitting", "lying_down", "grounded", "crawling", "squatting"],
    exceptions: {}
  },
  "covered_in_blood": {
    blocks: ["clean", "uninjured", "pristine", "immaculate"],
    exceptions: {}
  },
  "injury": {
    blocks: ["uninjured", "pristine", "immaculate", "healthy"],
    exceptions: {}
  },
  "wet": {
    blocks: ["dry", "dry_clothes", "fire"],
    exceptions: {}
  },
  "dirty": {
    blocks: ["clean", "immaculate", "pristine", "sparkling"],
    exceptions: {}
  },
  "bound": {
    blocks: ["free", "running", "jumping", "dancing", "fighting"],
    exceptions: {}
  },

  // === STYLISTIC CONCEPTS (13 tags) ===
  "monochrome": {
    blocks: ["colorful", "vibrant", "full_color", "multicolored", "rainbow"],
    exceptions: {
      "partially_colored": ["colorful", "full_color"],
      "spot_color": ["colorful", "full_color"]
    }
  },
  "sketch": {
    blocks: ["fully_colored", "masterpiece", "detailed", "photorealistic", "hyper_detailed", "3d", "realistic"],
    exceptions: {
      "colored_sketch": ["fully_colored", "detailed"]
    }
  },
  "lineart": {
    blocks: ["fully_colored", "photorealistic", "3d", "realistic", "hyper_detailed"],
    exceptions: {}
  },
  "3d": {
    blocks: ["2d", "anime_style", "cel_shading", "watercolor", "sketch", "pixel_art", "comic", "lineart"],
    exceptions: {}
  },
  "realistic": {
    blocks: ["2d", "anime_style", "cel_shading", "watercolor", "sketch", "pixel_art", "comic", "lineart", "chibi"],
    exceptions: {}
  },
  "pixel_art": {
    blocks: ["high_res", "vector", "3d", "photorealistic", "realistic", "watercolor", "masterpiece", "hyper_detailed"],
    exceptions: {}
  },
  "comic": {
    blocks: ["single_image", "portrait", "photorealistic", "realistic", "3d"],
    exceptions: {}
  },
  "censored": {
    blocks: ["uncensored", "explicit", "pussy", "penis", "nipples"],
    exceptions: {}
  },
  "mosaic_censoring": {
    blocks: ["uncensored", "explicit"],
    exceptions: {}
  },
  "uncensored": {
    blocks: ["censored", "mosaic_censoring", "bar_censor", "censor_steam", "light_beam", "convenient_censoring"],
    exceptions: {}
  },
  "parody": {
    blocks: ["original"],
    exceptions: {}
  },
  "meme": {
    blocks: ["serious", "photorealistic", "realistic", "masterpiece"],
    exceptions: {}
  },

  // === HAIR COLOR (NEW — from gap analysis) ===
  "blonde_hair": {
    blocks: ["black_hair", "brown_hair", "red_hair", "blue_hair", "pink_hair", "purple_hair", "green_hair", "white_hair", "silver_hair", "gray_hair", "orange_hair"],
    exceptions: {
      "two-tone_hair": ["black_hair", "brown_hair", "white_hair"],
      "multicolored_hair": ["black_hair", "brown_hair", "white_hair", "pink_hair", "blue_hair"],
      "streaked_hair": ["black_hair", "brown_hair", "white_hair", "pink_hair", "blue_hair", "red_hair"],
      "gradient_hair": ["black_hair", "brown_hair", "white_hair", "pink_hair", "blue_hair"]
    }
  },
  "black_hair": {
    blocks: ["blonde_hair", "white_hair", "silver_hair", "gray_hair", "red_hair", "blue_hair", "pink_hair", "green_hair", "orange_hair"],
    exceptions: {
      "two-tone_hair": ["blonde_hair", "white_hair", "red_hair", "pink_hair", "blue_hair"],
      "multicolored_hair": ["blonde_hair", "white_hair", "red_hair", "pink_hair", "blue_hair"],
      "streaked_hair": ["blonde_hair", "white_hair", "red_hair", "pink_hair", "blue_hair"],
      "gradient_hair": ["blonde_hair", "white_hair", "red_hair"]
    }
  },
  "white_hair": {
    blocks: ["black_hair", "brown_hair", "red_hair", "blue_hair", "pink_hair", "purple_hair", "green_hair", "orange_hair"],
    exceptions: {
      "two-tone_hair": ["black_hair", "brown_hair", "red_hair", "blue_hair"],
      "multicolored_hair": ["black_hair", "brown_hair", "red_hair", "blue_hair"],
      "streaked_hair": ["black_hair", "brown_hair", "red_hair", "blue_hair"],
      "gradient_hair": ["black_hair", "brown_hair", "red_hair", "blue_hair"]
    }
  },

  // === EYEWEAR (NEW — from gap analysis) ===
  "glasses": {
    blocks: ["blindfold", "eye_mask", "sleep_mask", "bare_face"],
    exceptions: {}
  },
  "blindfold": {
    blocks: ["glasses", "sunglasses", "monocle", "goggles", "looking_at_viewer", "eye_contact"],
    exceptions: {
      "see-through_blindfold": ["looking_at_viewer", "eye_contact"]
    }
  },

  // === WEAPONS (NEW — from gap analysis) ===
  "holding_weapon": {
    blocks: ["empty_hands", "hands_in_pockets", "arms_behind_back", "peaceful", "relaxing"],
    exceptions: {}
  },

  // === SPECIES (NEW — from gap analysis) ===
  "robot": {
    blocks: ["human", "flesh", "skin", "blood", "organic", "blush", "tears", "sweat", "saliva"],
    exceptions: {
      "android": ["blush", "tears", "sweat", "saliva"],
      "cyborg": ["human", "flesh", "skin", "blood", "blush", "tears", "sweat"],
      "gynoid": ["human", "blush"]
    }
  },
  "angel": {
    blocks: ["demon", "devil", "fallen_angel", "succubus", "incubus", "evil", "dark"],
    exceptions: {
      "fallen_angel": []
    }
  },
  "demon": {
    blocks: ["angel", "holy", "sacred", "pure", "blessed"],
    exceptions: {}
  },
  "vampire": {
    blocks: ["angel", "holy", "sacred", "sunlight", "garlic", "cross"],
    exceptions: {}
  },

  // === COMPOSITION (NEW — from gap analysis) ===
  "symmetry": {
    blocks: ["asymmetry", "chaotic", "random", "messy", "unbalanced"],
    exceptions: {}
  },

  // === ACTIONS — EXPANDED (NEW — from gap analysis) ===
  "swimming": {
    blocks: ["winter_clothes", "armor", "heavy_coat", "fully_clothed", "snow", "desert", "indoors"],
    exceptions: {
      "indoor_pool": ["indoors"]
    }
  },
  "dancing": {
    blocks: ["sleeping", "lying_down", "sitting", "kneeling", "seiza", "indian_style", "bound", "tied", "handcuffed"],
    exceptions: {}
  },
  "surprised": {
    blocks: ["calm", "peaceful", "sleeping", "bored", "apathetic", "content"],
    exceptions: {}
  },

  // === SETTING — EXPANDED (NEW — from gap analysis) ===
  "space": {
    blocks: ["sky", "cloud", "sun", "sunlight", "beach", "forest", "mountain", "ocean", "underwater", "rain", "snow"],
    exceptions: {
      "spaceship": ["sky", "cloud"],
      "planet": ["sky", "cloud", "mountain"]
    }
  },
  "cave": {
    blocks: ["sky", "sun", "outdoors", "sunlight", "beach", "ocean", "cloud", "sunny", "cityscape"],
    exceptions: {
      "cave_entrance": ["outdoors", "sunlight", "sky"],
      "open_cave": ["outdoors", "sky"]
    }
  },
  "ruins": {
    blocks: ["pristine", "new", "modern", "futuristic", "space_station", "laboratory"],
    exceptions: {}
  },

  // === POSTURE — EXPANDED (NEW — from gap analysis) ===
  "upside-down": {
    blocks: ["standing", "walking", "running", "sitting", "kneeling"],
    exceptions: {}
  },
  "handstand": {
    blocks: ["standing", "walking", "sitting", "lying_down", "kneeling", "seiza"],
    exceptions: {}
  },

  // === MISC EXPANSIONS (NEW — from gap analysis) ===
  "bald": {
    blocks: ["long_hair", "short_hair", "very_long_hair", "ponytail", "twintails", "braids", "hair_bun", "hair_down", "loose_hair", "medium_hair", "floor-length_hair",
             "blonde_hair", "brown_hair", "black_hair", "white_hair", "red_hair", "blue_hair", "pink_hair"],
    exceptions: {}
  },
  "armor": {
    blocks: ["nude", "naked", "topless", "bottomless", "swimsuit", "bikini", "bare_shoulders", "bare_chest", "bare_arms", "bare_legs",
             "tank_top", "camisole", "lingerie", "underwear", "panties"],
    exceptions: {
      "damaged_armor": ["bare_shoulders", "bare_arms", "bare_legs"],
      "broken_armor": ["bare_shoulders", "bare_chest", "bare_arms", "bare_legs"]
    }
  },
  "blood": {
    blocks: ["clean", "pristine", "immaculate", "peaceful", "sparkling", "pure"],
    exceptions: {}
  }
}

// Flexible matching to catch variants (e.g. "red eyes" falls under "eyes")
export function isRelatedTag(blockedTag: string, targetTag: string): boolean {
  const normBlocked = normalize(blockedTag);
  const normTarget = normalize(targetTag);
  
  if (normBlocked === normTarget) return true;
  
  // Suffix-based fuzzy matching for compound tags
  const suffixMap: Record<string, string[]> = {
    "eyes": ["eyes"],
    "hair": ["hair"],
    "breasts": ["breasts"],
    "skin": ["skin"],
    "legs": ["legs", "leg"],
    "arms": ["arms", "arm"],
    "clothes": ["clothes", "clothing", "clothed"],
    "shoes": ["shoes", "shoe"],
    "ears": ["ears", "ear"],
    "tail": ["tail", "tails"],
    "background": ["background"],
    "sleeves": ["sleeves", "sleeve"],
    "body": ["body"],
    "face": ["face"],
    "hands": ["hands", "hand"],
    "feet": ["feet", "foot"],
    "skirt": ["skirt", "skirts"],
    "dress": ["dress", "dresses"],
    "pants": ["pants"],
    "socks": ["socks", "sock"],
    "uniform": ["uniform", "uniforms"],
    "headwear": ["hat", "hood", "helmet", "cap", "beanie"],
    "neck": ["neck", "necks"],
    "teeth": ["teeth", "tooth", "fangs"],
    "tongue": ["tongue", "tongues"],
    "mouth": ["mouth", "mouths"],
    "lips": ["lips", "lip"],
    "nose": ["nose", "noses"],
    "eyebrows": ["eyebrows", "eyebrow"],
    "shoulders": ["shoulders", "shoulder"],
    "knees": ["knees", "knee"],
    "elbows": ["elbows", "elbow"],
    "wrists": ["wrists", "wrist"],
    "ankles": ["ankles", "ankle"],
    "toes": ["toes", "toe"],
    "fingers": ["fingers", "finger"],
    "thighs": ["thighs", "thigh"],
    "hips": ["hips", "hip"],
    "chest": ["chest", "chests"],
    "stomach": ["stomach", "stomachs"],
    "waist": ["waist", "waists"],
    "back": ["back", "backs"],
    "navel": ["navel", "navels"],
    "butt": ["butt", "butts", "ass"],
    "pussy": ["pussy"],
    "penis": ["penis"],
  };
  
  for (const [category, suffixes] of Object.entries(suffixMap)) {
    if (normBlocked === category) {
      for (const suffix of suffixes) {
        if (normTarget.endsWith(" " + suffix) || normTarget.startsWith(suffix + " ")) {
          return true;
        }
      }
    }
  }
  
  return false;
}

export interface ConflictResolution {
  validTags: string[];
  conflictingTags: { tag: string; reason: string }[];
}

  const POSTURE_TRIGGERS = ["from_behind", "back", "chest", "from behind"];
  const FACIAL_FEATURES = ["lips", "nose", "eyes", "mouth", "teeth", "tongue", "eyelashes", "makeup"];
  const GLOBAL_ENVIRONMENT_TAGS = ["day", "night", "sunset", "twilight", "indoors", "outdoors", "monochrome", "sketch", "pixel_art", "3d", "realistic", "white_background"];

  // Precomputed once at module load instead of re-allocating a 180-entry array
  // on every added-tag iteration inside resolveTagConflicts (hot path per card).
  const TAG_CONFLICT_ENTRIES = Object.entries(TAG_CONFLICTS);

  export function resolveTagConflicts(baseTags: string[], addedTags: string[]): ConflictResolution {
    const validTags: string[] = [];
    const conflictingTags: {tag: string, reason: string}[] = [];
    
    const normalizedBase = new Set(baseTags.map(t => normalize(t)));
    const normalizedAdded = addedTags.map(t => normalize(t));
  
    const baseTagsArray = Array.from(normalizedBase);
  
    // Global Context: Are there multiple characters?
    const hasMultipleCharacters = baseTagsArray.some(t => 
      /^[2-9]+(girls|boys)$/.test(t) || 
      t.includes("multiple ") || 
      t.includes("and ") || // e.g. "boy and girl"
      t === "girls" || 
      t === "boys" ||
      t === "group"
    );
  
    // Global Context: Are there explicit face indicators active?
    const hasFaceIndicators = baseTagsArray.some(t => 
      t.includes("eyes") || 
      t.includes("smile") || 
      t.includes("blush") || 
      t.includes("mouth") || 
      t.includes("tears") || 
      t.includes("looking at viewer") ||
      t.includes("face")
    );
  
    for (let i = 0; i < normalizedAdded.length; i++) {
      const originalAddedTag = addedTags[i];
      const added = normalizedAdded[i];
      let isBlocked = false;
      let reason = "";
  
      // GOLDEN RULE: If tag already exists in base, it's not a conflict
      // (The base prompt is the source of truth about what characteristics the character has)
      if (normalizedBase.has(added)) {
        validTags.push(originalAddedTag);
        continue;
      }
  
      for (const [trigger, rule] of TAG_CONFLICT_ENTRIES) {
        if (normalizedBase.has(trigger) || normalizedBase.has(normalize(trigger))) {
          const blocksAdded = rule.blocks.some(blocked => isRelatedTag(blocked, added));
          
          if (blocksAdded) {
            let unblocked = false;
  
            // GLOBAL EXCEPTION 1: Multiple characters invalidate character-specific blocks
            // e.g. 1girl might wear a dress, while 1boy wears a shirt.
            if (hasMultipleCharacters && !GLOBAL_ENVIRONMENT_TAGS.includes(trigger) && !["1girl", "1boy", "solo"].includes(trigger)) {
              unblocked = true;
            }
  
          // GLOBAL EXCEPTION 2: Face indicators unblock facial anatomy against posture blocks
          if (!unblocked && POSTURE_TRIGGERS.includes(trigger)) {
            if (hasFaceIndicators && FACIAL_FEATURES.some(f => isRelatedTag(f, added))) {
              unblocked = true;
            }
          }

          // SPECIFIC EXCEPTIONS (Iterate rules)
          if (!unblocked && rule.exceptions) {
            for (const [exceptionTrigger, unblockedList] of Object.entries(rule.exceptions)) {
              if (normalizedBase.has(exceptionTrigger) || normalizedBase.has(normalize(exceptionTrigger))) {
                if (unblockedList.some(unblockedTag => isRelatedTag(unblockedTag, added))) {
                  unblocked = true;
                  break; // Found an exception, tag is safe
                }
              }
            }
          }

          if (!unblocked) {
            isBlocked = true;
            reason = trigger;
            break; // Already proven blocked, no need to check other triggers
          }
        }
      }
    }

    if (isBlocked) {
      conflictingTags.push({ tag: originalAddedTag, reason: `Conflicts with '${reason}'` });
    } else {
      validTags.push(originalAddedTag);
    }
  }

  return { validTags, conflictingTags };
}
