
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  console.error('Please ensure .env.local exists and contains these keys.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const rawTags = `
 Headwear and Headgear 
 See tag group:headwear. 
 
 balaclava 
 coif 
 crown 
 diadem 
 hair bow 
 hair ribbon 
 hair tie 
 hairband 
 hat 
 headband 
 forehead protector 
 sweatband 
 hachimaki 
 mongkhon 
 headdress 
 maid headdress 
 headscarf 
 hijab 
 tiara 
 veil 
 honggaitou 
 wimple 
 Shirts and Topwear 
 blouse 
 frilled shirt 
 sleeveless shirt 
 bustier 
 crop top 
 camisole 
 cardigan 
 cardigan vest 
 coat 
 duffel coat 
 fur coat 
 fur-trimmed coat 
 long coat 
 overcoat 
 peacoat 
 raincoat 
 yellow raincoat 
 see-through raincoat 
 trench coat 
 winter coat 
 compression shirt 
 corset 
 deel 
 dress (see tag group:dress) 
 halterneck 
 criss-cross halter 
 halterneck 
 hoodie 
 jacket 
 blazer 
 cropped jacket (bolero) 
 letterman jacket 
 safari jacket 
 suit jacket 
 sukajan 
 trench coat 
 nightgown 
 muneate 
 poncho 
 raglan sleeves (see tag group:sleeves) 
 robe 
 thobe 
 sash 
 shoulder sash 
 stole 
 scapular 
 shirt 
 collared shirt 
 dress shirt 
 off-shoulder shirt 
 sleeveless shirt 
 striped shirt 
 t-shirt 
 shrug 
 surcoat 
 sweater 
 turtleneck sweater 
 sleeveless turtleneck 
 sweater dress 
 ribbed sweater 
 aran sweater 
 tabard 
 tailcoat 
 tank top 
 stringer 
 tube top 
 bandeau 
 underbust 
 vest 
 sweater vest 
 waistcoat 
 Pants and Bottomwear 
 bloomers 
 buruma 
 chaps 
 kilt 
 pants 
 bell-bottoms 
 capri pants 
 detached pants 
 jeans 
 cutoff jeans 
 lowleg pants 
 pants rolled up 
 yoga pants 
 pelvic curtain 
 petticoat 
 sarong 
 shorts 
 bike shorts 
 denim shorts 
 dolphin shorts 
 gym shorts 
 lowleg shorts 
 micro shorts 
 pleated shorts 
 short shorts 
 shorts under skirt 
 skirt 
 bubble skirt 
 high-waist skirt 
 high-low skirt 
 long skirt 
 lowleg skirt 
 microskirt 
 miniskirt 
 overall skirt 
 overskirt 
 plaid skirt (tartan/kilt skirt) 
 pleated skirt 
 showgirl skirt 
 suspender skirt 
 tutu 
 Legs and Feet 
 See tag group:legwear. 
 
 kneehighs 
 leggings 
 leg warmers 
 over-kneehighs 
 pantyhose 
 thighband pantyhose 
 socks 
 ankle socks 
 bobby socks 
 loose socks 
 tabi 
 toe socks 
 tube socks 
 thighhighs 
 Shoes and Footwear 
 shoes 
 boots 
 ankle boots 
 armored boots 
 cowboy boots 
 spurs 
 high heel boots 
 knee boots 
 lace-up boots 
 rubber boots 
 thigh boots 
 work boots 
 cross-laced footwear 
 ankle lace-up 
 cross-laced sandals 
 cross-laced shoes 
 cross-laced slit 
 lace-up boots 
 sneakers 
 high tops 
 converse 
 dress shoes 
 loafers 
 kiltie loafers 
 oxfords 
 saddle shoes 
 flats 
 footwear ribbon 
 high heels 
 pumps 
 stiletto heels 
 wedge heels 
 mary janes 
 platform footwear 
 okobo 
 platform boots 
 platform heels 
 platform sandals 
 platform shoes 
 pointy boots 
 pointy shoes 
 sandals 
 cross-laced sandals 
 flip-flops 
 gladiator sandals 
 geta 
 okobo 
 sports sandals 
 waraji 
 zouri 
 monk shoes 
 open-toe boots 
 open-toe shoes 
 slippers 
 animal slippers 
 ballet slippers 
 crocs 
 uwabaki 
 spats 
 uwabaki 
 winged 
 winged boots 
 winged sandals 
 winged shoes 
 winged slippers 
 Uniforms and Costumes 
 apron 
 armor 
 armored dress 
 bikini armor 
 band uniform 
 cape 
 capelet 
 hood 
 side cape 
 cassock 
 cheerleader 
 costume 
 ghost costume 
 formal clothes 
 suit 
 business suit 
 pant suit 
 skirt suit 
 tuxedo 
 g-suit 
 gym uniform 
 buruma 
 harem outfit 
 loincloth 
 hazmat suit 
 hev suit 
 kigurumi 
 animal costume 
 bear costume 
 boar costume 
 cat costume 
 cow costume 
 dog costume 
 monkey costume 
 mouse costume 
 panda costume 
 penguin costume 
 pig costume 
 rabbit costume 
 reindeer costume 
 seal costume 
 sheep costume 
 tiger costume 
 maid 
 jersey maid 
 mecha pilot suit 
 miko 
 nontraditional miko 
 military uniform 
 nun 
 traditional nun 
 overalls 
 pajamas 
 plugsuit 
 priest 
 sailor (naval uniform) 
 santa costume 
 school uniform 
 serafuku (sailor uniform) 
 sailor dress 
 gakuran 
 meiji schoolgirl uniform 
 shosei 
 track suit 
 sweatpants 
 sweater 
 tutu 
 waitress 
 cowboy western (cowboy outfit) 
 Swimsuits and Bodysuits 
 bikesuit 
 racing suit 
 bodystocking 
 bodysuit 
 jumpsuit 
 short jumpsuit 
 leotard 
 see-through leotard 
 strapless leotard 
 playboy bunny 
 swimsuit 
 competition swimsuit 
 slingshot swimsuit 
 school swimsuit 
 bikini 
 leaf bikini 
 string bikini 
 micro bikini 
 side-tie bikini bottom 
 lowleg bikini 
 thong bikini 
 venus bikini 
 sports bikini 
 tankini 
 criss-cross halter 
 swim briefs (speedo) 
 jammers 
 legskin 
 rash guard 
 robe 
 bathrobe 
 open robe 
 kesa 
 romper 
 sarong 
 tunic 
 unitard 
 Traditional Clothing 
 chinese clothes 
 changpao 
 china dress (cheongsam/qipao) 
 fengguan 
 hanfu 
 longpao 
 tangzhuang 
 dirndl 
 japanese clothes 
 fundoshi 
 mizu happi 
 geta 
 hakama 
 hakama skirt 
 hakama short skirt 
 hakama pants 
 kimono 
 furisode 
 layered kimono 
 short kimono 
 uchikake (wedding kimono) 
 yukata 
 haori 
 happi 
 chanchanko 
 dotera 
 hanten 
 kimono skirt 
 miko 
 nontraditional miko 
 sarashi 
 Midriff sarashi 
 Chest sarashi 
 Budget sarashi 
 Undone sarashi 
 straw cape (mino) 
 mino boushi 
 tabi 
 tasuki 
 korean clothes 
 hanbok 
 ao dai 
 Jewelry and Accessories 
 Head and Face 
 circlet 
 ear covers 
 ear cuffs 
 earrings 
 hoop earrings 
 stud earrings 
 earclip 
 ear chain 
 face chain 
 glasses (see tag group:eyewear) 
 monocle 
 hair ornament 
 dianzi 
 hair beads 
 hair bobbles 
 hairclip 
 hairpin 
 hair scrunchie 
 hair stick 
 kanzashi 
 head chain 
 headphones 
 earphones 
 earpiece 
 headset 
 laurel crown 
 mask 
 plague doctor mask 
 surgical mask 
 Neck and Shoulders 
 See tag group:neck and neckwear. 
 
 ascot 
 bowtie 
 choker 
 collar 
 cross tie 
 epaulettes 
 feather boa 
 guimpe 
 lapels 
 lapel pin 
 neck ruff 
 neckerchief 
 necklace 
 necktie 
 tie clip 
 neck ribbon 
 scarf 
 scarf choker 
 shawl 
 stole 
 usekh collar 
 Limbs 
 ankle strap 
 anklet 
 arm belt 
 arm guards 
 armband 
 armlet 
 bracer 
 bracelet 
 bangle 
 spiked bracelet 
 detached sleeves 
 arm warmers 
 elbow sleeve 
 fingernails 
 garter straps 
 gloves 
 boxing gloves 
 elbow gloves 
 fingerless gloves 
 bridal gauntlets 
 spiked gloves 
 yugake 
 mittens 
 hand chains 
 leg belt 
 legwear garter 
 ring 
 claw ring 
 wedding ring 
 shin guards 
 shin strap 
 thighlet 
 thigh strap 
 frilled thigh strap 
 wide sleeves 
 wristband 
 wrist cuffs 
 wrist ruff 
 wrist scrunchie 
 Torso and Misc 
 aiguillette 
 badge 
 belly chain 
 belt 
 buckle 
 wallet chain 
 sam browne belt 
 shoulder belt 
 cingulum militare 
 boutonniere 
 brooch 
 buttons 
 large buttons 
 button badge 
 buttoned cuffs 
 collar chain 
 sweater guard 
 corsage 
 crinoline 
 cuff links 
 double-breasted 
 fanny pack 
 garter belt 
 harness 
 pentacle 
 piercing (see tag group:piercings) 
 sarong 
 sash 
 shoulder sash 
 waist sash 
 shendyt 
 suspenders 
 tassel 
 watch 
 pocket watch 
 yaopei 
 zipper 
 Styles and Patterns 
 Patterns 
 argyle 
 camouflage 
 checkered 
 floral print 
 gingham 
 houndstooth 
 pinstripe pattern 
 plaid / tartan 
 polka dot 
 striped 
 multicolored stripes 
 double vertical stripe 
 Prints 
 animal print 
 bat print 
 bear print 
 butterfly print 
 cow print 
 leopard print 
 tiger print 
 snake print 
 bone print 
 clover print 
 crescent print 
 floral print 
 rose print 
 camellia print 
 cherry blossom print 
 chrysanthemum print 
 lily print 
 morning glory print 
 peony print 
 plum blossom print 
 spider lily print 
 sunflower print 
 food print 
 fruit pattern 
 apple print 
 blueberry print 
 cherry print 
 kiwi print 
 lemon print 
 pineapple print 
 orange print 
 strawberry print 
 watermelon print 
 leaf print 
 maple leaf print 
 moon print 
 musical note print 
 paw print 
 petal print 
 piano print 
 sparkle print 
 triangle print 
 space print 
 starry sky print 
 star print 
 wave print 
 wing print 
 Other 
 buckle 
 chinese knot 
 criss-cross straps 
 criss-cross back-straps 
 clothing cutout 
 dress flower 
 flower trim 
 frills 
 fur trim 
 gathers 
 gold trim 
 lace trim 
 pom pom 
 ribbon trim 
 see-through clothes 
 silver trim 
 taut shirt 
 torn clothes 
 white trim
`

const IGNORED_HEADERS = [
  'Headwear and Headgear',
  'Shirts and Topwear',
  'Pants and Bottomwear',
  'Legs and Feet',
  'Shoes and Footwear',
  'Uniforms and Costumes',
  'Swimsuits and Bodysuits',
  'Traditional Clothing',
  'Jewelry and Accessories',
  'Head and Face',
  'Neck and Shoulders',
  'Limbs',
  'Torso and Misc',
  'Styles and Patterns',
  'Patterns',
  'Prints',
  'Other'
]

async function seedClothingTags() {
  const lines = rawTags.split('\n')
  const tagsToInsert = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    // Ignore tag groups (case insensitive)
    if (trimmed.toLowerCase().includes('tag group:')) continue
    
    // Ignore headers
    if (IGNORED_HEADERS.includes(trimmed)) continue
    
    // Ignore lines that start with "See " (often references)
    if (trimmed.startsWith('See ')) continue

    let tagName = trimmed
    
    // Remove (see tag group:...)
    tagName = tagName.replace(/\(see tag group:.*?\)/i, '')
    
    // Remove other parenthetical notes if they look like descriptions (preceded by space)
    tagName = tagName.replace(/\s+\(.*?\)$/, '')
    
    tagName = tagName.trim().toLowerCase().replace(/ /g, '_')
    
    if (!tagName) continue

    tagsToInsert.push({
      name: tagName,
      category: 'clothing'
    })
  }

  // Remove duplicates
  const uniqueTags = Array.from(new Map(tagsToInsert.map(item => [item.name, item])).values())
  
  console.log(`Prepared ${uniqueTags.length} unique tags for insertion.`)

  // Batch insert
  const batchSize = 100
  for (let i = 0; i < uniqueTags.length; i += batchSize) {
    const batch = uniqueTags.slice(i, i + batchSize)
    const { error } = await supabase
      .from('tags')
      .upsert(batch, { onConflict: 'name', ignoreDuplicates: true })
      
    if (error) {
      console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error.message)
    } else {
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} (${Math.min(i + batchSize, uniqueTags.length)}/${uniqueTags.length})`)
    }
  }
  
  console.log('Done!')
}

seedClothingTags().catch(console.error)
