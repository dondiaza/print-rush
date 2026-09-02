import { MapSchema, Schema, type } from "@colyseus/schema";
import { RacePhase } from "@print-rush/game-core";

/**
 * The replicated kart state.
 *
 * V4 sent position, rotation, speed and boost. That is not enough for a remote kart to be drawn
 * correctly under the V5 model: without the velocity vector a sliding kart is rendered pointing
 * exactly where it travels, so every drift looks like a grip corner on other players' screens.
 */
export class KartStateSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0.75;
  @type("number") z = 0;
  @type("number") rotation = 0;
  /** World-space planar velocity. Required to reproduce slip angle on remote clients. */
  @type("number") vx = 0;
  @type("number") vz = 0;
  @type("number") speed = 0;
  @type("number") verticalSpeed = 0;
  @type("number") boostRemaining = 0;
  @type("uint8") boostTier = 0;
  @type("boolean") drifting = false;
  @type("int8") driftDirection = 0;
  @type("uint8") driftLevel = 0;
  @type("boolean") grounded = true;
}

export class PlayerStateSchema extends Schema {
  @type("string") id = "";
  @type("string") nickname = "Rider";
  @type("boolean") connected = true;
  @type("boolean") ready = false;
  @type("uint8") lap = 1;
  @type("uint8") checkpoint = 0;
  @type("uint8") racePosition = 1;
  @type("uint32") lastProcessedInput = 0;
  /**
   * The character, as the *server* resolved it.
   *
   * These replace broadcasting a whole `CharacterDefinition` that the joining client supplied. The
   * appearance is a small JSON blob — about twenty-five short fields — which the receiving client
   * turns into geometry with the same bridge the single-player game uses. The face is a media path
   * on the studio, never a photograph.
   *
   * `characterId` is empty for a client racing with a locally authored character, which still works:
   * nothing was migrated away.
   */
  @type("string") characterId = "";
  @type("string") characterName = "Piloto";
  @type("string") characterAppearance = "";
  @type("string") faceTextureUrl = "";
  @type("string") avatarThumbnailUrl = "";
  @type("uint32") characterVersion = 0;
  /** Kept for a client that has no persisted character and describes its own. */
  @type("string") characterDefinition = "";
  @type("string") kartDefinition = "";
  @type("string") characterHash = "";
  @type("string") kartHash = "";
  @type(KartStateSchema) kart = new KartStateSchema();
}

export class RaceStateSchema extends Schema {
  @type("string") roomId = "";
  @type("string") phase = RacePhase.LOBBY;
  @type("string") trackId = "tshirt-megastore";
  @type("uint8") lapsRequired = 3;
  @type("number") serverTime = 0;
  @type("number") countdown = 3;
  @type({ map: PlayerStateSchema }) players = new MapSchema<PlayerStateSchema>();
}
