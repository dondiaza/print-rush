export type BodyPreset = "SLIM" | "STANDARD" | "BROAD" | "SHORT" | "TALL";
export type CaricatureLevel = "SOFT" | "NORMAL" | "BOLD";
export type Personality = "CALM" | "ENERGETIC" | "COOL" | "FUNNY";
export type AvatarSource = "MANUAL" | "PHOTO" | "RANDOM" | "OFFICE";
export type RuntimeQuality = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

export type CharacterDefinition = {
  schemaVersion: 2;
  generatorVersion: "2.0.0";
  id: string;
  name: string;
  source: AvatarSource;
  seed: number;
  body: {
    preset: BodyPreset;
    height: number;
    shoulderWidth: number;
    torsoWidth: number;
    torsoLength: number;
    armLength: number;
    legLength: number;
    volume: number;
    headScale: number;
    handScale: number;
    footScale: number;
  };
  face: {
    width: number;
    height: number;
    jawWidth: number;
    jawRoundness: number;
    cheekVolume: number;
    chinSize: number;
    foreheadHeight: number;
    skinTone: string;
    undertone: "COOL" | "NEUTRAL" | "WARM";
    freckles: number;
    blush: number;
    eyes: { size: number; spacing: number; height: number; angle: number; roundness: number; irisColor: string };
    eyebrows: { preset: "STRAIGHT" | "ARCHED" | "THICK" | "THIN" | "SOFT"; thickness: number; height: number; angle: number; color: string };
    nose: { preset: "SMALL" | "MEDIUM" | "WIDE" | "ROUND" | "LONG"; width: number; length: number; tip: number; height: number };
    mouth: { width: number; lipThickness: number; height: number; curve: number };
    ears: { size: number; height: number; separation: number };
  };
  hair: { style: HairStyle; color: string; scale: number; volume: number; roughness: number };
  facialHair: { style: BeardStyle; color: string; density: number };
  glasses: { style: GlassesStyle; frameColor: string; lensTint: string; size: number };
  shirt: { model: "TSHIRT" | "SWEATSHIRT" | "HOODIE" | "JACKET"; baseColor: string; sleeveColor: string; collarColor: string; frontDesign: ShirtDesignId; backDesign: ShirtDesignId; designScale: number; designX: number; designY: number; designRotation: number };
  pants: { style: "JEANS" | "CHINO" | "JOGGER"; color: string };
  shoes: { style: "CLASSIC" | "RUNNER" | "HIGH_TOP"; color: string; soleColor: string };
  accessories: Array<"HEADPHONES" | "CAP" | "WATCH" | "BACKPACK" | "EARRINGS">;
  caricature: CaricatureLevel;
  personality: Personality;
  photo: null | {
    mode: "STYLIZED" | "PHOTO_FACE";
    strength: number;
    landmarkModel: string;
    originalRetained: false;
    analyzedAt: string;
  };
};

export type HairStyle =
  | "BALD" | "BUZZ" | "CREW" | "SHORT" | "PIXIE" | "SIDE_PART" | "SLICKED" | "UNDERCUT"
  | "MESSY_SHORT" | "CURLY_SHORT" | "WAVY_SHORT" | "BOB" | "MEDIUM" | "MESSY_MEDIUM"
  | "CURLY_MEDIUM" | "WAVY_MEDIUM" | "SHAG" | "LONG" | "LONG_WAVY" | "LONG_CURLY"
  | "PONYTAIL" | "HIGH_PONYTAIL" | "BUN" | "DOUBLE_BUN" | "BRAID" | "AFRO" | "AFRO_SHORT"
  | "MOHAWK" | "RECEDING" | "LOCS";

export type BeardStyle = "NONE" | "STUBBLE" | "MUSTACHE" | "GOATEE" | "SHORT" | "MEDIUM" | "FULL";
export type GlassesStyle = "NONE" | "RECTANGULAR" | "ROUND" | "LARGE" | "THIN" | "SUNGLASSES";
export type ShirtDesignId = "NONE" | "INK_BOLT" | "THREAD_WAVE" | "PRINT_SKULL" | "PACKAGE_CAT" | "CUSTOM";

export type KartDefinition = {
  schemaVersion: 2;
  generatorVersion: "2.0.0";
  id: string;
  name: string;
  seed: number;
  body: "CLASSIC" | "PACKAGE" | "SPRINT" | "ROLLER" | "INK_TANK";
  nose: "ROUND" | "WEDGE" | "BOX" | "TWIN";
  spoiler: "NONE" | "LOW" | "WING" | "DOUBLE";
  wheel: "CLASSIC" | "CHUNKY" | "SLICK" | "OFFROAD" | "ROLLER";
  rim: "DISC" | "FIVE_SPOKE" | "STAR" | "INK_SPLAT";
  antenna: "NONE" | "BALL" | "SHIRT" | "FLAG";
  primaryColor: string;
  secondaryColor: string;
  rimColor: string;
  decal: "NONE" | "BOLT" | "STRIPES" | "INK" | "NUMBER";
  number: number;
  finish: "MATTE" | "GLOSS" | "METALLIC" | "PEARL";
  compatibility: { driverScale: number; seatHeight: number; handTarget: number };
};

export type PropKind = "BOX" | "RACK" | "TABLE" | "SHELF" | "SIGN" | "BARRIER" | "LAMP" | "PLANT" | "MACHINE" | "CONVEYOR";

export type PropDefinition = {
  schemaVersion: 1;
  generatorVersion: "1.0.0";
  id: string;
  kind: PropKind;
  seed: number;
  palette: string;
  width: number;
  height: number;
  depth: number;
  detail: number;
  collision: "BOX" | "CYLINDER" | "NONE";
};

export type FactoryAsset = {
  id: string;
  type: "CHARACTER" | "KART" | "PROP" | "TRACK" | "WEAPON";
  name: string;
  version: number;
  hash: string;
  updatedAt: string;
  published: boolean;
};

export type ValidationIssue = { path: string; message: string; severity: "ERROR" | "WARNING" };
