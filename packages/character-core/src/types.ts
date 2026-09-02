/**
 * CHARACTER DOMAIN.
 *
 * The data model for the Character Studio, kept in a package rather than in the web app for one
 * concrete reason: the authoritative race server has to validate a `characterId` and hand rivals a
 * runtime payload, and it cannot import a Next.js component tree to do it. Both sides share these
 * types and the validators beside them, so "what is a valid appearance" has exactly one definition.
 *
 * Nothing here touches a database, a request or a canvas. That separation is what the brief asks for
 * and it is also what makes the rules testable without a server: appearance validation, version
 * significance and the runtime projection are all pure functions over these shapes.
 */

/** Lifecycle of a character. `DRAFT` exists because a photo can still be processing. */
export type CharacterStatus = "DRAFT" | "READY" | "ARCHIVED";

/**
 * Face processing state.
 *
 * These are the brief's states verbatim, and they matter: a failed photo must not take the character
 * with it. A character whose face is `FAILED` is still a character — it races with the fallback face
 * and the owner can retry or upload another photo.
 */
export type FaceProcessingState = "UPLOADED" | "VALIDATING" | "PROCESSING" | "READY" | "FAILED";

export type BodyPresetId = "BALANCED" | "SLIM" | "ATHLETIC" | "BROAD" | "SHORT" | "TALL";

export type HairStyleId =
  | "BALD"
  | "SHORT_01"
  | "SHORT_02"
  | "MEDIUM_01"
  | "MEDIUM_02"
  | "LONG_01"
  | "CURLY_01"
  | "TIED_01";

export type FacialHairId = "NONE" | "STUBBLE" | "SHORT" | "FULL" | "MOUSTACHE";

export type EyeStyleId = "NEUTRAL" | "WIDE" | "NARROW" | "FOCUSED";
export type EyebrowStyleId = "NEUTRAL" | "THICK" | "THIN" | "ANGLED";

export type TopId = "TEE" | "HOODIE" | "SHIRT" | "RACING_SUIT" | "POLO";
export type BottomId = "JEANS" | "CARGO" | "TRACK" | "RACING_SUIT" | "SHORTS";
export type ShoesId = "TRAINERS" | "BOOTS" | "RACING" | "CANVAS";
export type GlovesId = "NONE" | "RACING" | "WORK";
export type JacketId = "NONE" | "BOMBER" | "HIVIS" | "DENIM";

export type HeadwearId = "NONE" | "CAP" | "HELMET" | "BEANIE" | "HEADSET";
export type FaceAccessoryId = "NONE" | "GLASSES" | "SUNGLASSES" | "VISOR";
export type BackAccessoryId = "NONE" | "BACKPACK" | "TUBE" | "FLAG";
export type WristAccessoryId = "NONE" | "WATCH" | "BAND";

/**
 * A shirt print, drawn from the game's own baked designs.
 *
 * Named against the printed-fabric materials in the asset bake rather than invented here, so a
 * design cannot be selected that has no texture behind it.
 */
export type ShirtDesignId = "NONE" | "BOLT" | "WAVE" | "HALFTONE" | "SPLAT";

/**
 * Everything the player chooses about how a character looks.
 *
 * Flat rather than nested, deliberately: this is what an editor binds to, what a validator walks,
 * and what a version snapshot diffs. A nested tree would make all three more awkward for no gain.
 */
export type CharacterAppearance = {
  // ------------------------------------------------------------------ face
  skinTone: string;
  hairStyle: HairStyleId;
  hairColor: string;
  eyeStyle: EyeStyleId;
  eyebrowStyle: EyebrowStyleId;
  facialHair: FacialHairId;

  // ------------------------------------------------------------------ body
  bodyPreset: BodyPresetId;
  /**
   * Proportion multipliers, all clamped.
   *
   * The clamps are not cosmetic. A character that does not fit the kart, or whose hands cannot reach
   * the wheel, is a broken character — and the collider is fixed regardless of these, so extreme
   * values would buy nothing but visual bugs. See `APPEARANCE_LIMITS`.
   */
  heightScale: number;
  bodyWidth: number;
  shoulderWidth: number;
  headScale: number;
  legLength: number;

  // --------------------------------------------------------------- clothing
  top: TopId;
  shirtDesign: ShirtDesignId;
  bottom: BottomId;
  shoes: ShoesId;
  gloves: GlovesId;
  jacket: JacketId;

  // -------------------------------------------------------------- accessories
  accessoryHead: HeadwearId;
  accessoryFace: FaceAccessoryId;
  accessoryBack: BackAccessoryId;
  accessoryWrist: WristAccessoryId;

  // ------------------------------------------------------------------ colour
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
};

/**
 * The photograph and what was derived from it.
 *
 * `originalUrl` is the untouched upload and it is never served to a race client — the brief is
 * explicit that originals stay restricted, and these are photographs of colleagues. Only
 * `gameTextureUrl` and the thumbnails leave the studio.
 *
 * The crop parameters are stored rather than only applied, so a face can be restyled later without
 * asking the owner to upload and crop the photo again.
 */
export type CharacterFace = {
  id: string;
  characterId: string;
  state: FaceProcessingState;
  /** Why processing failed, in words a person can act on. Null unless `state` is FAILED. */
  failureReason: string | null;
  /** Private. Restricted to the owner and admins; never sent to other players. */
  originalUrl: string | null;
  /** The normalised crop the studio produced, before styling. Private. */
  croppedUrl: string | null;
  /** What the game actually samples. Safe to share with rivals. */
  gameTextureUrl: string | null;
  thumbnailUrl: string | null;
  crop: FaceCrop;
  /** Bumped whenever the styling pipeline changes, so old faces can be spotted and reprocessed. */
  processingVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type FaceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zoom: number;
};

export type Character = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: CharacterStatus;
  isActive: boolean;
  isPublic: boolean;
  isFavourite: boolean;
  version: number;
  appearance: CharacterAppearance;
  /** The face record, when one has been uploaded. */
  face: CharacterFace | null;
  /** Default kart. The player may still pick another before a race — the two are not welded. */
  defaultKartId: string | null;
  avatarThumbnailUrl: string | null;
  renderPreviewUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
};

/** A point-in-time snapshot, so a change is recoverable rather than destructive. */
export type CharacterVersion = {
  id: string;
  characterId: string;
  version: number;
  snapshot: CharacterSnapshot;
  createdAt: string;
  createdBy: string;
};

/** What a version stores. Appearance plus the identity fields a rollback should restore. */
export type CharacterSnapshot = {
  name: string;
  appearance: CharacterAppearance;
  defaultKartId: string | null;
  faceGameTextureUrl: string | null;
};

/**
 * What a race needs, and nothing else.
 *
 * The shape exists because the brief is right about the failure mode: a race that resolves a
 * character by calling several endpoints per player will stall the grid. One request per character
 * returns exactly this, it is cacheable, and it deliberately omits `originalUrl` so a rival client
 * is never handed a colleague's photograph.
 */
export type CharacterRuntime = {
  id: string;
  name: string;
  appearance: CharacterAppearance;
  /** Already-styled face texture, or null to use the fallback. */
  faceTextureUrl: string | null;
  avatarThumbnailUrl: string | null;
  kartId: string | null;
  /** Bumped when anything visual changes, so a runtime cache can be invalidated by comparison. */
  version: number;
};

/** A character paired with the kart chosen for one race. Kept separate on purpose. */
export type CharacterLoadout = {
  characterId: string;
  kartId: string;
};

/** Summary row for the library and the admin table. Never carries an appearance or a photo. */
export type CharacterSummary = {
  id: string;
  name: string;
  status: CharacterStatus;
  isFavourite: boolean;
  avatarThumbnailUrl: string | null;
  faceState: FaceProcessingState | null;
  defaultKartId: string | null;
  updatedAt: string;
  lastUsedAt: string | null;
  deletedAt: string | null;
};
